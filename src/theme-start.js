// Loaded synchronously after the stylesheets, before any body content paints.
// Only a non-sensitive theme ID is read; no note/credential storage is touched.
import {restoreTheme} from './theme.js';
restoreTheme();
