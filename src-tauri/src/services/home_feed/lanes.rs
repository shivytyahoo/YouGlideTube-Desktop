//! From raw fetches to ranked lanes to the first page, from the Android app's `HomeFeedAssembly`.

use std::collections::{HashMap, HashSet, VecDeque};

use super::arrange::{TasteProfile, spread_across_searches};
use super::card::Card;
use super::filters::{
    FRESH_SUB_WINDOW_MS, dynamic_fresh_sub_slots, is_fresh_subscribed, keep_showable,
};
use super::inputs::Inputs;
use super::mixer::{Blend, FeedSource, Page, blend, quotas};
use super::seeds::{GraphCandidate, apply_graph_boost};

pub const HOME_TARGET_SIZE: usize = 40;
const FRESH_SUBS_PIN_TOP: usize = 2;
/// Seen fresh uploads follow this many ranked subs.
const SHOWN_FRESH_AFTER_SUBS: usize = 3;
const BEST_SUBS_LIMIT: usize = 15;
const BEST_DISCOVERY_LIMIT: usize = 15;
const BEST_MEMORY_LIMIT: usize = 6;
const BEST_NEIGHBOUR_LIMIT: usize = 4;
const BEST_RELATED_LIMIT: usize = 12;

/// Cards keep the order their source gave them: subscriptions by recency, discovery by search
/// relevance. There is no engine ranking anymore.
#[must_use]
pub fn rank(cards: Vec<Card>, _subs: &HashSet<String>) -> Vec<Card> {
    cards
}

/// Spreads cards across channels, one per channel in turn, so no single channel fills a lane.
/// (The engine used to spread across interests; channels are the neutral proxy now.)
#[must_use]
pub fn share(cards: Vec<Card>, _subs: &HashSet<String>) -> Vec<Card> {
    let mut groups: Vec<(String, VecDeque<Card>)> = Vec::new();
    for card in cards {
        let key = if card.channel_id().is_empty() {
            card.id().to_string()
        } else {
            card.channel_id().to_string()
        };
        if let Some(group) = groups.iter_mut().find(|(k, _)| *k == key) {
            group.1.push_back(card);
        } else {
            groups.push((key, VecDeque::from([card])));
        }
    }
    let mut out = Vec::new();
    while groups.iter().any(|(_, queue)| !queue.is_empty()) {
        for (_, queue) in groups.iter_mut() {
            if let Some(card) = queue.pop_front() {
                out.push(card);
            }
        }
    }
    out
}

/// A related lane's cards demoted by fit, nudged by graph evidence and shared across channels.
#[must_use]
pub fn rank_related(
    candidates: &[GraphCandidate],
    subs: &HashSet<String>,
    taste: &TasteProfile,
) -> Vec<Card> {
    let metadata: HashMap<String, GraphCandidate> = candidates
        .iter()
        .map(|c| (c.card.id().to_string(), c.clone()))
        .collect();
    let ranked = rank(candidates.iter().map(|c| c.card.clone()).collect(), subs);
    share(taste.demote(apply_graph_boost(ranked, &metadata)), subs)
}

/// What one load fetched or read.
pub struct Raw {
    pub subs: Vec<Card>,
    pub rss: Vec<Card>,
    /// The server home feed's cards: the discovery lane's primary source.
    pub server: Vec<Card>,
    pub discovery: Vec<Card>,
    pub memory: Vec<Card>,
    pub related: Vec<GraphCandidate>,
    pub neighbours: Vec<Card>,
    pub query_of: HashMap<String, String>,
}

impl Raw {
    #[must_use]
    pub fn new(
        store: &[Card],
        server: Vec<Card>,
        searches: &[(String, Vec<Card>)],
        memory: Vec<Card>,
        related: Vec<GraphCandidate>,
        neighbours: Vec<Card>,
        now_ms: u64,
    ) -> Self {
        Self {
            subs: super::filters::stored_subscription_videos(store, now_ms),
            rss: store.to_vec(),
            server,
            discovery: searches
                .iter()
                .flat_map(|(_, cards)| cards.iter().cloned())
                .collect(),
            memory,
            related,
            neighbours,
            query_of: super::origin::queries_by_id(searches),
        }
    }
}

pub struct Lanes {
    pub pinned_fresh: Vec<Card>,
    pub overflow_fresh: Vec<Card>,
    pub shown_fresh: Vec<Card>,
    pub best_subs: Vec<Card>,
    pub best_discovery: Vec<Card>,
    pub best_memory: Vec<Card>,
    pub best_neighbours: Vec<Card>,
    pub best_related: Vec<Card>,
    pub related: Vec<GraphCandidate>,
    pub subs_by_recency: Vec<Card>,
    /// Cards in the discovery lane that came from the server home feed.
    pub server_ids: HashSet<String>,
}

impl Lanes {
    fn fresh_candidates(&self) -> impl Iterator<Item = &Card> {
        self.pinned_fresh
            .iter()
            .chain(&self.overflow_fresh)
            .chain(&self.best_subs)
            .chain(&self.shown_fresh)
            .chain(&self.best_related)
            .chain(&self.best_discovery)
            .chain(&self.best_memory)
            .chain(&self.best_neighbours)
    }
}

fn with_avatar(mut card: Card, avatars: &HashMap<String, String>) -> Card {
    if card.video.channel_avatar_url.is_none()
        && let Some(avatar) = avatars.get(card.channel_id())
    {
        card.video.channel_avatar_url = Some(avatar.clone());
    }
    card
}

fn distinct_by<T>(items: Vec<T>, key: impl Fn(&T) -> String) -> Vec<T> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| seen.insert(key(item)))
        .collect()
}

/// The ranked lanes the blend draws from. Subscriptions rank by recency; discovery, related and
/// neighbours keep their source order and share their places across channels.
pub fn build(
    raw: Raw,
    inputs: &Inputs,
    recently_shown: &HashSet<String>,
    taste: &TasteProfile,
    now_ms: u64,
) -> Lanes {
    let subs = inputs.boosted_channels();
    let hidden = |card: &Card| inputs.exclusions.hides(card);
    let avatars = &inputs.subscriptions.avatars;
    let subs_pool: Vec<Card> = distinct_by(
        keep_showable(raw.subs, &inputs.watched, &hidden, now_ms, false)
            .map(|c| with_avatar(c, avatars))
            .collect(),
        |c| c.id().to_string(),
    );
    // The server feed leads the discovery lane; the searches only fill
    // what it did not already offer, in the server's own order.
    let server_ids: HashSet<String> = raw.server.iter().map(|c| c.id().to_string()).collect();
    let discovery_pool: Vec<Card> = distinct_by(
        keep_showable(
            raw.server.into_iter().chain(raw.discovery),
            &inputs.watched,
            &hidden,
            now_ms,
            true,
        )
        .collect(),
        |c| c.id().to_string(),
    );
    let memory_pool: Vec<Card> =
        keep_showable(raw.memory, &inputs.watched, &hidden, now_ms, true).collect();
    let neighbour_pool: Vec<Card> =
        keep_showable(raw.neighbours, &inputs.watched, &hidden, now_ms, true).collect();

    let mut subs_by_recency = subs_pool.clone();
    subs_by_recency.sort_by_key(|c| std::cmp::Reverse(c.published_at_ms));

    let (shown_fresh, unshown_fresh) = fresh_lanes(
        raw.rss,
        &subs_by_recency,
        inputs,
        recently_shown,
        dynamic_fresh_sub_slots(subs.len()),
        now_ms,
    );
    let fresh_ids: HashSet<&str> = shown_fresh
        .iter()
        .chain(&unshown_fresh)
        .map(Card::id)
        .collect();

    let best_subs: Vec<Card> = rank(subs_by_recency.clone(), &subs)
        .into_iter()
        .filter(|c| !fresh_ids.contains(c.id()))
        .take(BEST_SUBS_LIMIT)
        .collect();

    let related: Vec<GraphCandidate> = raw
        .related
        .into_iter()
        .filter(|g| {
            g.card.is_valid()
                && !inputs.watched.contains(g.card.id())
                && super::filters::is_recent_suggestion(&g.card, now_ms)
                && !hidden(&g.card)
        })
        .collect();

    // Neighbours are new to the viewer, so they are kept as a lane of their own.
    let relevant_neighbours = rank(neighbour_pool, &subs);
    let ranked_discovery = rank(discovery_pool, &subs);
    let best_discovery = spread_across_searches(
        share(taste.demote(ranked_discovery), &subs),
        &raw.query_of,
        BEST_DISCOVERY_LIMIT,
    );
    let server_ids: HashSet<String> = best_discovery
        .iter()
        .filter(|c| server_ids.contains(c.id()))
        .map(|c| c.id().to_string())
        .collect();
    let best_memory = distinct_by(taste.demote(rank(memory_pool, &subs)), |c| {
        c.channel_id().to_string()
    })
    .into_iter()
    .take(BEST_MEMORY_LIMIT)
    .collect();
    let best_neighbours = distinct_by(taste.demote(relevant_neighbours), |c| {
        c.channel_id().to_string()
    })
    .into_iter()
    .take(BEST_NEIGHBOUR_LIMIT)
    .collect();
    let best_related = rank_related(&related, &subs, taste)
        .into_iter()
        .take(BEST_RELATED_LIMIT)
        .collect();

    Lanes {
        pinned_fresh: unshown_fresh
            .iter()
            .take(FRESH_SUBS_PIN_TOP)
            .cloned()
            .collect(),
        overflow_fresh: unshown_fresh.into_iter().skip(FRESH_SUBS_PIN_TOP).collect(),
        shown_fresh,
        best_subs,
        best_discovery,
        best_memory,
        best_neighbours,
        best_related,
        related,
        subs_by_recency,
        server_ids,
    }
}

/// Fresh uploads of followed channels, one per channel, newest first: those not shown lately to
/// pin on top, those shown lately to follow the first ranked subs.
fn fresh_lanes(
    rss: Vec<Card>,
    subs_by_recency: &[Card],
    inputs: &Inputs,
    recently_shown: &HashSet<String>,
    slots: usize,
    now_ms: u64,
) -> (Vec<Card>, Vec<Card>) {
    let hidden = |card: &Card| inputs.exclusions.hides(card);
    let avatars = &inputs.subscriptions.avatars;
    // The store covers every followed channel with real publish times, so a fresh upload shows
    // even when its channel missed this load's fetch window.
    let rss_fresh = rss.into_iter().filter(|card| {
        card.is_valid()
            && card
                .age_ms(now_ms)
                .is_some_and(|age| age <= FRESH_SUB_WINDOW_MS)
            && !hidden(card)
    });
    let mut fresh: Vec<Card> = distinct_by(
        rss_fresh
            .chain(
                subs_by_recency
                    .iter()
                    .filter(|c| is_fresh_subscribed(c, now_ms))
                    .cloned(),
            )
            .filter(|c| !inputs.watched.contains(c.id()))
            .map(|c| with_avatar(c, avatars))
            .collect(),
        |c| c.id().to_string(),
    );
    fresh.sort_by_key(|c| std::cmp::Reverse(c.published_at_ms));
    // One fresh slot per channel.
    let fresh = distinct_by(fresh, |c| {
        if c.channel_id().is_empty() {
            c.id().to_string()
        } else {
            c.channel_id().to_string()
        }
    });
    // An upload shown recently goes to the back of the subs lane, so it is not pinned on top of
    // every launch for three days.
    let (shown, unshown): (Vec<Card>, Vec<Card>) = fresh
        .into_iter()
        .partition(|c| recently_shown.contains(c.id()));
    (
        shown.into_iter().take(slots).collect(),
        unshown.into_iter().take(slots).collect(),
    )
}

/// The first page and what it left for later.
pub struct Mix {
    pub cards: Vec<Card>,
    pub source_of: HashMap<String, FeedSource>,
    pub fresh_added: usize,
    pub memory_quota: usize,
    pub subs_backlog: Vec<Card>,
    /// Cards in the mix that came from the server home feed.
    pub server_ids: HashSet<String>,
}

/// Pinned fresh uploads first, then the quota blend. Cards on screen are left out so a refresh
/// looks different, while the lanes could still fill half the page without them.
#[must_use]
pub fn assemble(
    lanes: &Lanes,
    on_screen: &HashSet<String>,
    sub_count: usize,
    total_interactions: i32,
) -> Mix {
    let mut page = Page::default();
    if !on_screen.is_empty() {
        let fresh: HashSet<&str> = lanes
            .fresh_candidates()
            .map(Card::id)
            .filter(|id| !on_screen.contains(*id))
            .collect();
        if fresh.len() >= HOME_TARGET_SIZE / 2 {
            page.used_ids.extend(on_screen.iter().cloned());
        }
    }
    let mut source_of = HashMap::new();
    let mut fresh_added = 0;
    for card in &lanes.pinned_fresh {
        if page.add(card, 2) {
            fresh_added += 1;
            source_of.insert(card.id().to_string(), FeedSource::Subs);
        }
    }
    let remaining = HOME_TARGET_SIZE.saturating_sub(page.cards.len());
    let quotas = quotas(
        remaining,
        sub_count,
        total_interactions,
        !lanes.best_neighbours.is_empty(),
    );
    let subs_lane: Vec<Card> = lanes
        .overflow_fresh
        .iter()
        .chain(lanes.best_subs.iter().take(SHOWN_FRESH_AFTER_SUBS))
        .chain(&lanes.shown_fresh)
        .chain(lanes.best_subs.iter().skip(SHOWN_FRESH_AFTER_SUBS))
        .cloned()
        .collect();
    let lane_map = HashMap::from([
        (FeedSource::Subs, subs_lane),
        (FeedSource::Related, lanes.best_related.clone()),
        (FeedSource::Discovery, lanes.best_discovery.clone()),
        (FeedSource::ChannelMemory, lanes.best_memory.clone()),
        (FeedSource::Neighbours, lanes.best_neighbours.clone()),
    ]);
    let single: HashSet<String> = lanes
        .best_memory
        .iter()
        .chain(&lanes.best_neighbours)
        .map(|c| c.channel_id().to_string())
        .collect();
    let Blend { items, .. } = blend(&lane_map, &quotas, remaining, &mut page, &single);
    for (card, source) in &items {
        source_of.insert(card.id().to_string(), *source);
    }
    let cards: Vec<Card> = page.cards;
    let used: HashSet<&str> = cards.iter().map(Card::id).collect();
    let subs_backlog = lanes
        .subs_by_recency
        .iter()
        .filter(|c| !used.contains(c.id()) && !page.used_ids.contains(c.id()))
        .cloned()
        .collect();
    Mix {
        cards,
        source_of,
        fresh_added,
        memory_quota: quotas.get(&FeedSource::ChannelMemory).copied().unwrap_or(0),
        subs_backlog,
        server_ids: lanes.server_ids.clone(),
    }
}
