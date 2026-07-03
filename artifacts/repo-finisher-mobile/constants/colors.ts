/**
 * Semantic design tokens for the mobile app.
 *
 * Synced from the sibling web artifact (artifacts/repo-finisher/src/index.css).
 * RepoFinisher is a single dark, terminal-styled theme, so both `light` and
 * `dark` keys point at the same dark palette — the app always renders dark
 * regardless of device appearance setting (app.json userInterfaceStyle: dark).
 */

const dark = {
  text: "#f0f2f5",
  tint: "#76f17e",

  background: "#0a0d12",
  foreground: "#f0f2f5",

  card: "#13171e",
  cardForeground: "#f0f2f5",

  primary: "#76f17e",
  primaryForeground: "#060d06",

  secondary: "#232933",
  secondaryForeground: "#f0f2f5",

  muted: "#1b1f27",
  mutedForeground: "#9199a5",

  accent: "#2a3342",
  accentForeground: "#f0f2f5",

  destructive: "#f94144",
  destructiveForeground: "#f0f2f5",

  border: "#232933",
  input: "#232933",

  // Recommendation-kind accent colors (match web's --ship/--combine/--repurpose)
  ship: "#76f17e",
  combine: "#a981ff",
  repurpose: "#ffb330",
};

const colors = {
  light: dark,
  dark,
  radius: 10,
};

export default colors;
