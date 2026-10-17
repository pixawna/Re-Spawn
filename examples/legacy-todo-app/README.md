# legacy-todo-app

A small to-do app from 2020, used as Re:Spawn's reference patient.

It pins `webpack@4.46.0` and `webpack-cli@3.3.12`. On Node.js 17 and newer, webpack 4 hashes
modules with MD4, which OpenSSL 3 no longer provides, so `npm run build` fails with
`ERR_OSSL_EVP_UNSUPPORTED`. Nothing here is faked: try it yourself.

```bash
npm install && npm run build   # fails on Node >= 17
npm test                       # the logic itself is fine
```
