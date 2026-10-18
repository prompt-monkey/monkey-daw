# Third-party licenses

monkey-daw's own code is under the MIT license (see `LICENSE`). The built app also includes these
libraries, each under its own license. Their full license texts ship with each package in
`node_modules`.

## MP3 encoder: lamejs (LGPL-3.0)

MP3 export uses [`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs)
1.2.7, a JavaScript port of the LAME MP3 encoder by Alex Zhukov
([source](https://github.com/shijinyu/lamejs)), licensed under the GNU Lesser General Public
License, version 3.

It is used unmodified, as a separate npm package, and is bundled only into the MP3 export worker
(`src/audio/mp3.ts`). To use a different or modified version, replace the package (for example with
`npm install` of your build) and rebuild the app with `npm run build`.

The LGPL-3.0 text is at <https://www.gnu.org/licenses/lgpl-3.0.html>, and the GPL-3.0 it builds
on at <https://www.gnu.org/licenses/gpl-3.0.html>.

## Other libraries

| Library | License |
|---|---|
| [React](https://react.dev) and React DOM, scheduler | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | MIT |
| [Immer](https://github.com/immerjs/immer) | MIT |
| [fflate](https://github.com/101arrowz/fflate) | MIT |
| [Dexie.js](https://dexie.org) | Apache-2.0 |
