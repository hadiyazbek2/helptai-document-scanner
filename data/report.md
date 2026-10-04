# helptai test data report

Built 2026-10-04 09:02 UTC from `usage.csv` (25 Gemini requests) and `results.csv` (11 test runs).

## Token use by model

Output cost includes thinking tokens, as Google bills them. "intro" is the launch price that runs to the end of 2026; "standard" is the price after that.

|  | requests | ok | refused | failed | input tokens | output tokens | thinking tokens | total tokens | cost (intro price) | cost (standard price) |
|---|---|---|---|---|---|---|---|---|---|---|
| gemini-3.5-flash | 2 | 2 | 0 | 0 | 17,073 | 8,727 | 19,003 | 44,803 | $0.2752 | $0.2752 |
| gemini-3.6-flash | 15 | 6 | 0 | 9 | 69,296 | 28,805 | 16,963 | 115,064 | $0.2236 | $0.4472 |
| gemini-3.8-flash | 8 | 1 | 0 | 7 | 9,746 | 6,323 | 1,496 | 17,565 | $0.0366 | $0.0733 |
| **all models** | 25 | 9 | 0 | 16 | 96,115 | 43,855 | 37,462 | 177,432 | $0.5354 | $0.7956 |

## Token use by day

|  | requests | ok | refused | failed | input tokens | output tokens | thinking tokens | total tokens | cost (intro price) | cost (standard price) |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-04 gemini-3.5-flash | 2 | 2 | 0 | 0 | 17,073 | 8,727 | 19,003 | 44,803 | $0.2752 | $0.2752 |
| 2026-10-04 gemini-3.6-flash | 15 | 6 | 0 | 9 | 69,296 | 28,805 | 16,963 | 115,064 | $0.2236 | $0.4472 |
| 2026-10-04 gemini-3.8-flash | 8 | 1 | 0 | 7 | 9,746 | 6,323 | 1,496 | 17,565 | $0.0366 | $0.0733 |

## Every successful document request

| time | document | model | frames | seconds | input | output | thinking | cost (intro) |
|---|---|---|---|---|---|---|---|---|
| 2026-10-04 09:30 | handwriting | gemini-3.5-flash | 8 | 109 | 9,587 | 5,399 | 7,322 | $0.1289 |
| 2026-10-04 10:10 | handwriting | gemini-3.6-flash | 12 | 36 | 14,117 | 6,076 | 1,445 | $0.0388 |
| 2026-10-04 10:15 | Book | gemini-3.6-flash | 11 | 46 | 12,997 | 5,781 | 4,478 | $0.0482 |
| 2026-10-04 10:20 | Book | gemini-3.6-flash | 11 | 41 | 13,134 | 5,948 | 2,917 | $0.0431 |
| 2026-10-04 08:54 | handwriting | gemini-3.8-flash | 8 | 25 | 9,746 | 6,323 | 1,496 | $0.0366 |
| 2026-10-04 08:55 | Book | gemini-3.5-flash | 6 | 59 | 7,486 | 3,328 | 11,681 | $0.1463 |
| 2026-10-04 08:56 | handwriting | gemini-3.6-flash | 12 | 46 | 14,264 | 5,802 | 2,800 | $0.0430 |
| 2026-10-04 08:58 | Book | gemini-3.6-flash | 11 | 38 | 13,134 | 4,303 | 3,313 | $0.0384 |

## Test runs

"Ranges covered" is how many of the hand-labelled pages got at least one kept frame; "junk" is kept frames that are not on any page (page flips, blur); "mapping" is how many pages got a best frame from the right part of the video.

| run | video | cand. | frames | selection s | ranges covered | junk | model | gemini s | pages (expected) | mapping | flagged | in | out | think | cost (intro) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 20261004-085244 | Book | 1 | 6 | 5.5 | 5/5 | 0 | – | – | – | – | – | – | – | – | – |
| 20261004-085251 | handwriting | 1 | 8 | 5.5 | 8/8 | 0 | – | – | – | – | – | – | – | – | – |
| 20261004-085258 | Book | 3 | 11 | 6.2 | 5/5 | 0 | – | – | – | – | – | – | – | – | – |
| 20261004-085306 | handwriting | 3 | 12 | 6.4 | 8/8 | 0 | – | – | – | – | – | – | – | – | – |
| 20261004-085319 | handwriting | 1 | 8 | 5.4 | 8/8 | 0 | gemini-3.8-flash | 74.9 | 8 (8) | 8/8 | 2 | 9,746 | 6,323 | 1,496 | $0.0366 |
| 20261004-085440 | Book | 1 | 6 | 5.5 | 5/5 | 0 | gemini-3.5-flash | 123.5 | 5 (5) | 5/5 | 0 | 7,486 | 3,328 | 11,681 | $0.1463 |
| 20261004-085651 | handwriting | 3 | 12 | 6.5 | 8/8 | 0 | gemini-3.6-flash | 45.6 | 8 (8) | 8/8 | 1 | 14,264 | 5,802 | 2,800 | $0.0430 |
| 20261004-085744 | Book | 3 | 11 | 6.5 | 5/5 | 0 | gemini-3.6-flash | 81.9 | 5 (5) | 5/5 | 0 | 13,134 | 4,303 | 3,313 | $0.0384 |
| 20261004-085943 | handwriting | 1 | 8 | 5.5 | 8/8 | 0 | – | 1.9 | – | – | – | – | – | – | – |
| 20261004-085952 | Book | 1 | 6 | 5.5 | 5/5 | 0 | – | 0.0 | – | – | – | – | – | – | – |
| 20261004-090029 | handwriting | 3 | 12 | 6.0 | 8/8 | 0 | – | 22.1 | – | – | – | – | – | – | – |
