# Contributing

This started as a personal benchmark, but issues and PRs are welcome:

- **New task proposals / trap questions:** open an issue describing the failure mode you want
  to catch, ideally with a reference answer and a rubric sketch (0–2 / 3–4 / 5–6 / 7–8 / 9–10).
- **Reference-key corrections:** medical (Category 2, 5.3, 8.2) and French-locale reference
  answers move as guidelines update — if you can cite a current HAS/SPILF/collège source that
  contradicts a key in `knight-bench-v1.md`, open an issue with the citation.
- **New model runs:** follow the fairness rules in `knight-bench-v1.md` §0 exactly (same system
  prompt, same temperature policy, one attempt, no retries) and drop results under
  `results/<model>-results/` following the existing folder shape before opening a PR.
- **Web app:** see [`web-app/README.md`](./web-app/README.md) for the dev setup. UI/data bugs
  (a page not matching the source file it's rendering) are always welcome as issues.

Do not paste `knight-bench-v1.md` into a model under test except as individual task prompts at
run time — see the contamination rule in §12 of the spec.
