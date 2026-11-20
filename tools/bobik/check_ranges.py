#!/usr/bin/env python3
"""Compile the actual chunking function and check native/long-song boundaries."""
from pathlib import Path
import subprocess
import sys

import tempfile
root = Path(__file__).resolve().parents[2]
work = tempfile.TemporaryDirectory(prefix='hotstep-ranges-')
out = Path(work.name)
source = (root / 'engine/src/yue2/yue2-pipeline.h').read_text()
start = source.index('static std::vector<std::pair<int64_t, int64_t>> yue2_chunk_ranges(')
end = source.index('\n}\n', start) + 3
test = '''#include <algorithm>
#include <vector>
#include <utility>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cassert>
''' + source[start:end] + '''
int main() {
    unsetenv("BOBIK_YUE2_NAR_MAX_SECONDS");
    auto old = yue2_chunk_ranges(6247, 3731, 24576, 6000);
    assert(old.size() == 2 && old[0].second == 3124);
    assert(yue2_chunk_ranges(15000, 3731, 24576, 15000).size() == 2);
    setenv("BOBIK_YUE2_NAR_MAX_SECONDS", "600", 1);
    for (int prefix : {1, 3731, 8000}) {
        for (int frames : {1500, 6247, 7500, 15000}) {
            auto r = yue2_chunk_ranges(frames, prefix, 24576, 15000);
            assert(r.size() == 1 && r[0].first == 0 && r[0].second == frames);
        }
        auto r = yue2_chunk_ranges(30001, prefix, 24576, 0);
        int64_t previous = 0;
        for (auto range : r) {
            assert(range.first == previous && range.second-range.first <= 15000);
            previous = range.second;
        }
        assert(previous == 30001);
    }
    auto explicit_short = yue2_chunk_ranges(6247, 3731, 24576, 6000);
    assert(explicit_short.size() == 2 && explicit_short[0].second == 3124);
    setenv("BOBIK_YUE2_NAR_MAX_SECONDS", "garbage", 1);
    assert(yue2_chunk_ranges(15000, 3731, 24576, 15000).size() == 2);
}
'''
path = out / 'check_ranges.cpp'
path.write_text(test)
subprocess.run(['g++', '-std=c++17', '-O2', str(path), '-o', str(out/'check_ranges')], check=True)
subprocess.run([str(out/'check_ranges')], check=True)
print('Actual C++ chunk ranges: native, 600s, explicit shorter cap, overflow, invalid env passed')
