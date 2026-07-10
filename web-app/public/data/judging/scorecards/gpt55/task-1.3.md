SCORE: 8 (FINAL)
AUTO_CHECKS: 7/7, failures: none
BAND_JUSTIFICATION: This is a 7-8 band refactor: it uses one interval, makes cleanup abort outstanding work, includes `streamId`, `refreshMs`, and `onError` in the dependency list, and preserves the prompt's JSX structure exactly. The 59-line component and all eight self-audit rows were mechanically verified. It does not earn 9-10 because it does not explicitly call out the inherited missing-`refreshMs` defect and it handles changing `onError` by effect recreation rather than an error-handler ref. The output's `controllers.forEach(controller => controller.abort())` is concrete unmount protection.
UNVERIFIED_CLAIMS: Network endpoint response shapes are assumed from the prompt.
RED_FLAGS: none
