# YouGlideTube Desktop on Linux

Help for installing and running YouGlideTube Desktop on Linux. For the list of
supported systems, see the [README](../README.md#downloads-and-supported-systems).

## Which package to pick

| Your system | Package | Install with |
| --- | --- | --- |
| Debian, Ubuntu, Linux Mint, Pop!_OS | `.deb` | `sudo apt install ./YouGlideTube_*.deb` |
| Fedora, RHEL and its rebuilds | `.rpm` | `sudo dnf install ./YouGlideTube_*.rpm` |
| openSUSE | `.rpm` | `sudo zypper install ./YouGlideTube_*.rpm` |
| Arch, Manjaro, EndeavourOS | AUR | `youglidetube-desktop-bin` (prebuilt) or `youglidetube-desktop` (built from source) |
| Any distribution with Flatpak, including immutable ones (Fedora Silverblue, SteamOS) | Flatpak (manual build) | Build from the manifest in `packaging/flatpak/` (see its README), then `flatpak install --user YouGlideTube.flatpak` |
| Anything else | AppImage | Make it executable and run it |

Install a `.deb` or `.rpm` with the commands above rather than `dpkg -i` or
`rpm -i`, so the codec packages YouGlideTube needs come with it.

The AppImage brings its own WebKitGTK and codecs, so it plays everything
without system packages. The `.deb`, `.rpm` and AUR packages use your
system's WebKitGTK and GStreamer, which get your distribution's security
updates. YouGlideTube's own Flatpak builds from source on the GNOME runtime
with its codecs, and updates through `flatpak update` (the app's own updater
stays off there). It keeps its library and settings inside its sandbox, with
access to your Videos, Music and Downloads folders for downloads. It is
still in testing.

### Stable and Beta

Each channel installs as its own app with its own data:

| Channel | Menu name | Command |
| --- | --- | --- |
| Stable | YouGlideTube | `youglidetube` |
| Beta | YouGlideTube Beta | `youglidetube-beta` |

The `.deb` and `.rpm` packages of different channels can be installed side
by side. The AUR packages install the app as `youglidetube`.

The command is `youglidetube`.

## Graphics problems

If YouGlideTube opens to a blank, black, white or flickering window, it is
usually WebKitGTK's GPU rendering failing on your driver (often NVIDIA, or
some Wayland sessions). YouGlideTube notices a launch that never showed a
picture and uses safer settings on the next launch by itself. You can also
choose:

- **Settings > Appearance > Graphics compatibility**: Automatic (the
  default), Compatible (turns off the GPU buffer sharing that fails on some
  drivers) or Safe (also draws in software and uses X11). It applies the
  next time YouGlideTube starts.
- **Start with safe graphics**: right-click YouGlideTube in your app menu
  or dock and pick this action to start once in Safe mode, for example when
  the window is too broken to reach Settings. From a terminal, run
  `youglidetube --safe-graphics`, or set `YOUGLIDETUBE_SAFE_GRAPHICS=1`.

Advanced users can set the WebKitGTK variables themselves before starting
YouGlideTube. Your own values always win:

- `WEBKIT_DISABLE_DMABUF_RENDERER=1` turns off GPU buffer sharing, and `=0`
  turns it back on when YouGlideTube turned it off.
- `WEBKIT_DISABLE_COMPOSITING_MODE=1` draws the page in software.
- `GDK_BACKEND=x11` runs the window through X11 or XWayland.

## Video codecs

Video plays through WebKitGTK and your system's GStreamer plugins. If sound
plays but the picture stays frozen, a video decoder is missing. YouGlideTube
names the missing codec on the player and falls back to VP9 where it can.

- **Debian and Ubuntu:** `sudo apt install gstreamer1.0-libav`. The `.deb`
  already pulls it in.
- **Fedora:** Fedora's own packages can't decode most YouTube H.264 video.
  Enable [RPM Fusion](https://rpmfusion.org/Configuration), then run
  `sudo dnf swap ffmpeg-free ffmpeg --allowerasing` and
  `sudo dnf install gstreamer1-plugin-libav`. `gstreamer1-plugin-openh264`
  and `gstreamer1-plugin-dav1d` (AV1) help too, and the `.rpm` recommends
  them.
- **Arch:** `sudo pacman -S gst-libav`. The AUR packages already depend on it.
- **openSUSE:** add the [Packman](https://en.opensuse.org/Additional_package_repositories#Packman)
  repository, then install `gstreamer-plugins-libav` and
  `gstreamer-plugins-bad-codecs` from it.

The AppImage needs none of these.

### Node.js

YouGlideTube can use Node.js 18 or newer, when it is installed, as a
fallback for YouTube's bot check. The packages recommend `nodejs`. Ubuntu
22.04's own `nodejs` is too old for this; playback still works without it.

## Media keys

**Settings > Keyboard Shortcuts > Global media keys** makes your keyboard's
play, next and previous keys work while YouGlideTube is in the background.
This needs an X11 session today: Wayland doesn't let apps listen for keys
outside their own window.

## Moving from Beta to Stable

Beta and Stable keep separate libraries, so moving over takes a backup:

1. In YouGlideTube Beta, open **Settings > Data** and export a backup.
2. In YouGlideTube (Stable), open **Settings > Data** and import the file.
   On first start you can also pick **Restore a backup** during setup.

You can then uninstall YouGlideTube Beta, or keep both.
