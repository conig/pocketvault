# NvChad base46 palettes

Source: https://github.com/NvChad/base46

The complete set of 98 standard themes from the default `v3.0` branch is
bundled at revision `d870ec89a7b2f28c4accce515f97b7bcc5b9d200`.
`src/themes/base46.json` preserves each theme's original name, type,
`base_30` and `base_16` colours, and leading source/credit comments.
The upstream MIT notices are included alongside this file.

Pocket Vault maps these palettes to web UI and Markdown syntax. It does not
execute Lua at runtime or emulate Neovim-specific `polish_hl`, integrations,
user overrides, transparency or plugin configuration.

To update, review a clean checkout of the official repository, then run from
the Pocket Vault root (requires Lua and Git only for this maintenance step):

```sh
node scripts/import-base46.mjs /path/to/base46
npm test
npm run build
npm run test:themes
```

The importer evaluates the reviewed upstream Lua with identity theme overrides
and default NvChad UI settings so computed palettes are preserved. Use only
trusted upstream source, never an untrusted theme checkout. It validates every
palette and records the exact revision. Normal builds are entirely local and
do not need Lua, Neovim or a network connection.
