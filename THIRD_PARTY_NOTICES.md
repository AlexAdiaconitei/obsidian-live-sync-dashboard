# Third-party notices

Pinned package versions and integrity hashes are in `package.json` and `pnpm-lock.yaml`. The container
retains package license files in `node_modules` and runtime licensing in its base image. Build tools are omitted from the production image; compiled browser assets retain license comments. Browser assets embed
code from LiveSync commonlib and its resolved dependencies. Review transitive license changes when
updating the lockfile.

## MIT components

- LiveSync commonlib 0.1.34, Copyright (c) 2022 vorotamoroz. Source:
  https://github.com/vrtmrz/livesync-commonlib
- Phosphor Icons core 2.1.1, Copyright (c) 2023 Phosphor Icons. Source:
  https://github.com/phosphor-icons/core
- Hono 4.13.13, Copyright (c) 2021 - present, Yusuke Wada and Hono contributors. Source:
  https://github.com/honojs/hono
- octagonal-wheels 0.1.54, Copyright (c) 2024 vorotamoroz. Source:
  https://github.com/vrtmrz/octagonal-wheels
- qrcode-generator 1.5.2, Copyright (c) 2009 Kazuhiko Arase. Source:
  https://github.com/kazuhikoarase/qrcode-generator
- noble-ciphers, noble-curves, noble-hashes, noble-post-quantum and scure-base, bundled through
  age-encryption, Copyright (c) 2022 Paul Miller (https://paulmillr.com). Source:
  https://github.com/paulmillr

The following MIT license applies to each component above with its respective copyright:

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## htmx 2.0.11

Source: https://github.com/bigskysoftware/htmx

```text
Zero-Clause BSD

Permission to use, copy, modify, and/or distribute this software for
any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL
WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE
FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY
DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN
AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## age-encryption 0.3.1

Browser recovery keys and backup decryption. Source: https://github.com/FiloSottile/typage

```text
Copyright 2023 The age Authors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of the age project nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Container tools

The backup image packages age, rclone, jq, bash, coreutils, GNU tar, flock and tzdata from Alpine.
Their package licenses and notices are governed by the respective upstream projects. CouchDB and
Tailscale run as separate images. This project does not change their licenses.

- age: https://github.com/FiloSottile/age
- rclone: https://github.com/rclone/rclone
- jq: https://github.com/jqlang/jq
- Node.js: https://github.com/nodejs/node
- Hono Node.js adapter: https://github.com/honojs/node-server
- Tailwind CSS: https://github.com/tailwindlabs/tailwindcss
- esbuild: https://github.com/evanw/esbuild
