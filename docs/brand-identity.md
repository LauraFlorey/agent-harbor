# Agent Harbor visual identity

Agent Harbor's primary mark is a beacon-topped `A` opening onto two harbor waves. The beacon represents
direction and supervision; the open center and waves represent a safe workspace where a fleet of agents can
arrive, operate, and return.

## Palette

| Role | Color |
|---|---|
| Midnight tile | `#060A11` to `#17283A` |
| Harbor teal | `#8BF6E7` and `#31C6DF` |
| Navigation blue | `#3478F6` |
| Signal light | `#FFE59A` to `#FFAA43` |

The warm signal light should remain a small focal point. Teal and blue carry the main mark so it stays calm,
technical, and legible against the application's dark interface.

## Asset sources

- `build/icon.svg` is the padded native-packaging source for macOS, Windows, and Linux derivatives.
- `public/app-icon.svg` is the full-tile browser and in-app source.
- Agent avatars remain individually colored and expressive. They identify members of the fleet; they are not
  the Agent Harbor product mark.

Keep the silhouette simple enough to survive at 16 px. Generate native raster assets from `build/icon.svg`
rather than redrawing the mark separately.
