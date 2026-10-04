# data/ — test results and token use

Everything the tests produce is saved here so you can look at it later.

| Path | What it is |
|---|---|
| `usage.csv` | **One row per Gemini request** (including failed or refused attempts): time, endpoint, model, API key number, outcome, how long it took, how many frames were sent, and the **input / output / thinking / total tokens**. The server writes it automatically every time it calls Gemini. The first five rows were measured by hand earlier. |
| `results.csv` | **One row per test run** (`npm run eval`): which video, how many frames were kept, how long selection took, how many pages came back, whether they match the expected pages, tokens and estimated cost. |
| `runs/<run>/` | Everything about one run: `selection.json` (every kept frame with its time and clarity), `frames/` (the kept frames, not saved in git), `response.json` (Gemini's full answer), `pages.md` (a readable summary of each page), `summary.json`. |
| `videos/` | Test videos (not saved in git, they are large) and `<name>.expected.json` files that say how many pages the video has and when each page is on screen. |
| `pricing.json` | Gemini prices used to estimate cost. Update it when Google changes prices. |
| `report.md` | A readable summary built from the tables by `npm run report`. |

## Commands (run from the project folder; `npm run dev` must be running for `eval`)

```bash
npm run eval -- data/videos/Book.mp4                 # select frames, call Gemini, save everything
npm run eval -- data/videos/Book.mp4 --no-gemini     # frame selection only (free, no tokens)
npm run eval -- data/videos/*.mp4 --candidates 1     # compare: only the sharpest frame per page
npm run report                                       # rebuild data/report.md and print it
```

## Adding a video

1. Copy it into `data/videos/`.
2. (Optional but valuable) add `data/videos/<name>.expected.json` with the number of pages and, for each page, the seconds when it is clearly on screen: `{ "pages": 3, "ranges": [[0, 4], [6, 10], [12, 15]] }`. With it, the report shows how many pages were found, whether each page's photo is the right one, and how many kept frames were junk (page flips, blur).
