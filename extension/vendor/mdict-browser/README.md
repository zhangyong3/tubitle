# mdict-browser vendor

Browser-only adaptation of `@iwater/mdict-ts` 1.0.6, used under its MIT license.
The Node-only XML and filesystem fallbacks were removed so Chrome uses native
`DOMParser`, `TextDecoder`, `DataView`, `File`, and `FileReader` APIs.

Upstream: https://github.com/iwater/mdict-ts
