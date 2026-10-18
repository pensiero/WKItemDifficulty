# WaniKani Item Difficulty

A userscript for [WaniKani](https://www.wanikani.com) that shows how hard each kanji and vocabulary item is:

- **for other learners**: how often learners who had reached the item's level named it as their single worst kanji or vocab (2022 data from 88,968 WaniKani users)
- **for you**: your own accuracy on the item and whether it has become a leech (from your review history)

Difficulty comes in four bands, **Easy**, **Medium**, **Hard** and **Very hard**, drawn as one to four rising bars. Because of the bars, the bands are readable without color.

## Where it shows

| Where | What |
|---|---|
| Lessons | A badge at the bottom right of the item header |
| Reviews, lesson quizzes, extra study, recent mistakes | The same badge, **after you answer** by default (or only after a wrong answer, right away, or never) |
| Item pages (`/kanji/…`, `/vocabulary/…`) | A badge next to the title |
| Item info | A **Difficulty** section with the details, also reachable from the page's *Go To* bar |
| Lesson picker | A dot on each item, with a legend, so you can mix easy and hard items in a batch |
| Item grids | A dot on each item on level pages, the dashboard, kanji and vocabulary lists and related-item lists |

Hover over or click a badge to see the details:

- where the item sits in its level, and how many learners named it their worst
- whether those learners got the meaning or the reading wrong
- how far the data for that level can be trusted
- your own accuracy, your weak side (meaning or reading), and whether it is a leech

## How difficulty is calculated

**The data.** In September 2022 saraqael collected the public profiles of 88,968 WaniKani users who also had a community forum account ([thread](https://community.wanikani.com/t/new-combined-user-statistics/58741), [read-only sheet](https://docs.google.com/spreadsheets/d/1uq8f1N4rfsQS26N1RRKusnwWOfJZhfwsSHs1VI9aElo)). Each profile showed the user's level, their single **worst kanji** and **worst vocab**, and how often they had answered that item's meaning and reading correctly. An item's **votes** are the number of users for whom it was the worst one.

**The ranking.** Early items are seen by far more users than late ones (all 88,968 reached level 1; 2,167 reached level 60), so votes are only compared within a level. Each item is ranked against the items of the same type that shared its WaniKani level in 2022. The rank becomes a band:

| Band | Share of the level |
|---|---|
| Easy | the easiest 50% |
| Medium | the next 25% |
| Hard | the next 15% |
| Very hard | the hardest 10% |

Items tied on votes share the same rank. Items nobody voted for therefore land around the middle of the zero-vote group, not at the bottom.

**Confidence.** The users are split into two random halves and each half ranks the items. The level's confidence is how well the two rankings agree ([split-half reliability](docs/data-report.md)). It is above 0.9 for levels 1–10 and mostly 0.8–0.95 for levels 11–25. It drops for late levels, where only a few thousand users had arrived: around 0.7 for kanji and 0.55–0.65 for vocabulary at levels 41–60. The detail view shows high (0.85 or more), medium (0.7 or more) or low.

**Reading or meaning.** The split comes from the wrong answers of the users who voted for the item. It is shown only when at least 5 users voted for it.

**What changed since 2022.** WaniKani has since moved 429 of these items to other levels. They are still ranked against their 2022 level-mates, and the detail view says so. 53 items no longer exist. Items added after 2022, kana-only vocabulary and radicals have no community data; for them the script shows your own difficulty only.

**Your difficulty** uses your WaniKani review statistics, once you have answered an item at least 4 times. The leech score is wrong answers divided by the current streak to the power of 1.5, as in the community's leech scripts.

| Band | Rule |
|---|---|
| Very hard | under 70% correct, or a leech score of 3 or more |
| Hard | under 80% correct, or a leech score of 1.5 or more |
| Medium | under 90% correct |
| Easy | otherwise |

### Changes from v0.23

Up to v0.23 the score was the item's share of votes divided by the most-voted item of its level, times 10. One outlier per level then pushed most items to the bottom: 60% of vocabulary showed as green. The ranking was also hard to read as a number like "4.2/10". The vote counts are the same; v1.0 only changes how they are turned into a difficulty.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
   - **Chrome / Edge 138+:** open Tampermonkey's extension details and turn on **Allow User Scripts**.
2. Recommended: install the [WaniKani Open Framework](https://community.wanikani.com/t/instructions-installing-wanikani-open-framework/28549). Without it, the script still shows difficulty in lessons, reviews, item pages and the lesson picker. Your own difficulty, the dots on item grids and the entry in WaniKani's scripts menu need the framework.
3. Install **WaniKani Item Difficulty** from [Greasy Fork](https://greasyfork.org/scripts/457095-wanikani-item-difficulty).

## Settings

Open the settings from the badge popover (**Settings**), from WaniKani's scripts menu (with the Open Framework), or from Tampermonkey's menu. You can choose:

- where the difficulty shows and when reviews reveal it
- whether dots show all difficulties or only hard and very hard items
- whether dots show other learners' difficulty or yours
- the color set: traffic light, colorblind-safe or monochrome

Settings from v0.23 carry over where they still apply. For example, "Nowhere" in reviews becomes "Never".

## Development

`main.js` is the userscript; it has no build step. The pure core (data decoding, ranking, your difficulty, reveal rules, URL routing) is exported to Node for tests.

```sh
npm test               # unit, data and metadata tests
npm run build-data     # rebuild the data block in main.js and docs/data-report.md
```

`tools/build-data.mjs` downloads the sheet's `rawuserdata` tab and reads the current WaniKani subjects (`WK_TOKEN=<read-only token>` on the first run). It joins them with `data/wk-2022-items.json`, the items WaniKani had in 2022 and their 2022 levels. The data block holds only subject ids, vote counts and reading shares, no WaniKani content. Usernames from the sheet are never stored.

## Credits

- saraqael: the original script and the 2022 dataset
- Inserio: v0.23.1 (Turbo navigation, gradients)
- pensiero: v1.0
- [WK Item Info Injector](https://greasyfork.org/scripts/430565) by Sinyaven
- [WaniKani Open Framework](https://github.com/rfindley/wanikani-open-framework) by rfindley

MIT license.
