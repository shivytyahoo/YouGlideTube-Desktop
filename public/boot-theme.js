// Paints the last theme before the app loads, so the first frame is already in the
// right colours. ThemeController (src/lib/useTheme.ts) writes the snapshot.
(function () {
  try {
    var raw = window.localStorage.getItem("youglidetube_boot_theme")
      || window.localStorage.getItem("flow_boot_theme");
    if (!raw) return;
    var theme = JSON.parse(raw);
    var root = document.documentElement;
    var variables = theme.variables || {};
    Object.keys(variables).forEach(function (name) {
      root.style.setProperty(name, variables[name]);
    });
    if (theme.themeId) root.dataset.theme = theme.themeId;
    if (theme.variant) {
      root.dataset.themeVariant = theme.variant;
      root.style.colorScheme = theme.variant === "light" ? "light" : "dark";
    }
    // Glass theme: the shell is transparent from the first paint, so the
    // native backdrop shows through before React applies the class itself.
    if (theme.glass) root.classList.add("glass-theme");
  } catch (error) {
    // Without a snapshot the stylesheet's own defaults apply, as before.
  }
})();
