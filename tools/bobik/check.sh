#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
root_dir=$PWD
node --test ui/src/utils/editReplay.test.mjs
python3 tools/bobik/check_ranges.py
(
  cd server
  export BOBIK_ACTIVITY_LEASE_SCRIPT="$root_dir/server/src/bobik/fake_activity_lease.py"
  node --import tsx --test src/bobik/*.test.ts \
    src/services/backends/minimaxOfficial/official.test.ts \
    src/services/backends/yue2/generate.test.ts \
    src/services/backends/yue2/pick.test.ts \
    src/services/backends/yue2/durationCap.test.ts \
    ../ui/src/stores/globalParamsStore.officialSeed.test.ts \
    ../ui/src/stores/globalParamsStore.yue2SongState.test.ts \
    src/services/workflows/instaGenWorkflow.test.ts \
    ../ui/src/components/library/songBadges.test.ts \
    ../ui/src/components/details/songFacts.test.ts \
    ../ui/src/stores/playbackStore.mediaSession.test.ts
  npm run typecheck
)
npm run build --prefix ui
node release/esbuild.config.mjs
