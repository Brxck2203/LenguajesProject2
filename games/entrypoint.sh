#!/bin/sh
set -eu
node -e 'const fs=require("fs"); const config={goUrl:process.env.VITE_GO_URL,scalaUrl:process.env.VITE_SCALA_URL,prologUrl:process.env.VITE_PROLOG_URL}; fs.writeFileSync("/app/console/dist/runtime-config.js", `window.GAMECONSOLE_CONFIG=${JSON.stringify(config)};\n`);'
exec npm run preview
