# WaniKani Item Difficulty

A userscript for [WaniKani](https://www.wanikani.com) that shows how hard each kanji and vocabulary item is:

- **for other learners**: compared with everything up to your level, from how often learners named it as their single worst kanji or vocab (2022 data from 88,968 WaniKani users)
- **for you**: compared with the other items you have reviewed, from your own accuracy, plus whether it has become a leech

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

- where the item sits among everything up to your level, with its likely range shaded
- how many learners named it their worst, and whether they got the meaning or the reading wrong
- your own accuracy, your weak side (meaning or reading), and whether it is a leech

## How difficulty is calculated

**The data.** In September 2022 saraqael collected the public profiles of 88,968 WaniKani users who also had a community forum account ([thread](https://community.wanikani.com/t/new-combined-user-statistics/58741), [read-only sheet](https://docs.google.com/spreadsheets/d/1uq8f1N4rfsQS26N1RRKusnwWOfJZhfwsSHs1VI9aElo)). Each profile showed the user's level, their single **worst kanji** and **worst vocab**, and how often they had answered that item's meaning and reading correctly. An item's **votes** are the number of users for whom it was the worst one.

**Why raw votes can't be compared.** Early items are seen by far more users than late ones (all 88,968 reached level 1; 2,167 reached level 60). And people overwhelmingly name something they learned recently: an item from the user's current level is about 12 times more likely to be named their worst than one learned 10 or more levels earlier (see [the data report](docs/data-report.md)).

**The model.** Each user picked their worst item among everything they had learned. The script models that choice for all users at once: the chance of picking an item is proportional to the item's difficulty times a recency weight for how many levels ago it was learned. The fitted difficulty takes recency and the number of users out of the picture, so it compares items across levels. Two random halves of the users agree on the resulting ranking at 0.87 (split-half reliability: 0.86–0.98 for levels 1–20, 0.76–0.87 for levels 21–30 and 0.65–0.8 for levels 31–60).

After this correction, late kanji are not harder on average than early ones; late vocabulary is somewhat harder. Difficulty here means difficulty *for the learner who meets the item*: by level 50 you are a stronger learner than at level 10.

**The bands.** An item is compared with all items of its type (kanji or vocabulary) **up to your current level**, or up to its own level when it is above yours. Without the Open Framework, the script doesn't know your level and uses the item's.

| Band | Share of the comparison |
|---|---|
| Easy | the easiest 50% |
| Medium | the next 25% |
| Hard | the next 15% |
| Very hard | the hardest 10% |

**Not enough data.** The difficulty comes with a likely range (90%). Few votes, or a late level that few users reached, mean a wide range. Zero votes is evidence too, but only as strong as the number of users who could have voted. If the range covers one or two bands, the script shows the band of its best estimate and the details mention the range. If it covers three or four, it says **Not enough data** and shows no dot. That is the case for about 28% of kanji and 49% of vocabulary. For those, your own difficulty is more useful once you have reviewed the item.

**Reading or meaning.** The split comes from the wrong answers of the users who voted for the item. It is shown only when at least 5 users voted for it.

**What changed since 2022.** WaniKani has since moved 429 of these items to other levels. They are compared at their current level, and their evidence comes from the users who met them at their 2022 level; the details say so. 53 items no longer exist. Items added after 2022, kana-only vocabulary and radicals have no community data; for them the script shows your own difficulty only.

**Your difficulty** uses your WaniKani review statistics, once you have answered an item at least 4 times. Your accuracy on the item is compared with your other reviewed items of the same type (radicals, kanji or vocabulary), with the same bands. So it calibrates itself: 85% correct is *Hard* if most of your items are above 85%. A few pseudo-answers at your overall accuracy keep 3 out of 4 from outranking 70 out of 100. The **leech** tag is separate: wrong answers on the meaning or the reading, divided by the current streak to the power of 1.5, is 1.5 or more (as in the community's leech scripts).

### Changes from v0.23

Up to v0.23 the score was the item's share of votes divided by the most-voted item of its level, times 10. One outlier per level then pushed most items to the bottom: 60% of vocabulary showed as green. Items were only compared within their own level, and items with no votes looked easy even when nobody could tell. The votes are the same; v1.0 changes how they are turned into a difficulty.

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

`main.js` is the userscript; it has no build step. The pure core (data decoding, ranking and likely ranges, your difficulty, reveal rules, URL routing) is exported to Node for tests.

```sh
npm test               # unit, data and metadata tests
npm run build-data     # rebuild the data block in main.js and docs/data-report.md
```

`tools/build-data.mjs` downloads the sheet's `rawuserdata` tab and reads the current WaniKani subjects (`WK_TOKEN=<read-only token>` on the first run). It joins them with `data/wk-2022-items.json`, the items WaniKani had in 2022 and their 2022 levels, fits the model, and writes the data block: subject ids, current and 2022 levels, vote counts, reading shares and the evidence per level. No WaniKani content. Usernames from the sheet are never stored.

## Credits

- saraqael: the original script and the 2022 dataset
- Inserio: v0.23.1 (Turbo navigation, gradients)
- pensiero: v1.0
- [WK Item Info Injector](https://greasyfork.org/scripts/430565) by Sinyaven
- [WaniKani Open Framework](https://github.com/rfindley/wanikani-open-framework) by rfindley

MIT license.
