# End-to-end smoke test (T30)

Run on a clean machine (Node 22+, uv, no prior `.venv` / `node_modules`) before tagging a kit release.

Needs: an Atlas 9.0 M10+ cluster with your IP on the access list, a Voyage key (Atlas model API key) and an OpenAI key.

## Checklist

- [ ] `npm run new -- smoke --modules search-lab,graph-view --out /tmp` finishes without errors
- [ ] `cd /tmp/smoke && npm run dev` starts API (`:8000`) and web (`:5173`); <http://127.0.0.1:5173> opens Setup
- [ ] Search Lab and Graph View are greyed out in the nav with a tooltip
- [ ] Setup with **Voyage**: paste URI + key, **Save**. The URI shows `user:••••@`, key shows last 4
- [ ] Reload: fields stay blank, placeholders show the saved values. **Save** again with blank secrets keeps them
- [ ] **Test Connections**: all rows `ok`, ping row shows MongoDB 9.x, embedding row shows 1024 dims
- [ ] Wrong password → ping row `fail` with credentials hint. Restore it
- [ ] **Seed Database** → confirm → per-collection progress to done (`products` 2000, `nodes` 500)
- [ ] **Create Indexes** → each index goes to `ready`; "All indexes ready"
- [ ] Nav enables both modules
- [ ] **Search Lab**: query returns 4 columns; hover cross-highlights; category chip and max price filter all columns; weight slider changes Hybrid order; **Query** opens drawer with pipeline, Copy works, Explain shows stats
- [ ] **Graph View**: query renders a graph coloured by depth; click a node expands without the layout jumping; edge-type and node-type filters change the traversal; **Query** drawer shows `$vectorSearch` → `$graphLookup`
- [ ] Switch provider to **OpenAI** + key, **Save** → "Re-seed required" banner; module pages show not-ready; `POST /api/search-lab/query` returns `409 RESEED_REQUIRED`
- [ ] Seed + Create Indexes again (1536 dims) → modules work; Rerank column is disabled with a tooltip
- [ ] `git -C /tmp/smoke status` shows no `api/config/settings.json`; `ls -l api/config/settings.json` is `-rw-------`
- [ ] API log contains no password or key (`grep` for both)
- [ ] Record a GIF of Setup → Search Lab → Graph View and commit it as `docs/demo.gif` in the template

## Results

| Date | Kit commit | Machine | Result | Notes |
|---|---|---|---|---|
| | | | | |
