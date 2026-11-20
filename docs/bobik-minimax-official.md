# Official MiniMax-Music3 on Bobik

Set `BOBIK_MM3_OFFICIAL_URL` to a trusted loopback adapter URL to register
`minimax-official`. The standard backend selector then offers
**MiniMax-Music3 · Official**. Without that environment variable, existing
installations are unchanged. The native `minimax-m3` backend stays separate.

The backend uses the same queue, cancellation signal, library and player as
other engines. Each job captures caption, lyrics, duration ceiling, seed
and `mm3OfficialSteps` at enqueue time. Only text-to-music is supported, one
track at a time, up to 300 seconds; Auto means a 300-second ceiling. The model
may end sooner. The checkpoint's CFG and sampling defaults are used.
Native MM3 sampler plugins, saved plans and post-processing do not apply.

Adapter contract: `GET /health`, `POST /jobs`, `GET /jobs/:id`,
`GET /jobs/:id/audio`, `DELETE /jobs/:id`. Cancellation must acknowledge
`process_exited: true` before the queue lease is released. The service starts
a fresh CUDA subprocess per render and waits for exit before returning
completed audio. It is local-only, not a public API. Bobik splits the LM across GPU4/5 and moves it to RAM before synthesis.
The native engine uses GPU4 and is evicted by the shared queue before an official render. Generations
remain serialized by HOT-Step's queue.

Runtime installation, pinned weights/dependencies and V100 verification live
in TeslaBobik under `integrations/hot-step/minimax-official-20261120`.
The source revision, actual precision and timings are recorded in every
song's `mm3OfficialResult`.
