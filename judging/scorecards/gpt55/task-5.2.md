SCORE: 2 (FINAL)
AUTO_CHECKS: 4/5, failures: supplied Python test suite does not run
BAND_JUSTIFICATION: The submitted design contains good ingredients, including `remove_diacritics`, explicit oe/ligature handling, data-driven abbreviations, and more than eight assertions. But it falls in the 0-2 band because runnable code is a core requirement and all 12 supplied tests fail with `sqlite3.DatabaseError: database disk image is malformed` during the FTS delete path. The direct module run also exits nonzero. Strong-looking unexecuted test coverage cannot offset a broken persistence operation.
UNVERIFIED_CLAIMS: None; the submitted tests were executed and failed.
RED_FLAGS: runnable-code failure
