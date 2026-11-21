//! Small helpers for the stored brain's link keys. Nothing here learns or ranks;
//! the brain is inert stored data now, and these keys only keep old backups readable.

/// The key of a link between two topics, the way the Android app writes it ("a|b", in order).
pub fn make_affinity_key(t1: &str, t2: &str) -> String {
    if t1 < t2 {
        format!("{t1}|{t2}")
    } else {
        format!("{t2}|{t1}")
    }
}
