# Forum post draft (for saraqael's thread)

> Draft for the first post of https://community.wanikani.com/t/userscript-item-difficulty-indicator/59876, or a reply in it. Screenshots go where marked.

---

## v1.0: a modernized Item Difficulty 🟢🟡🟠🔴

The script works again with the current WaniKani UI and shows up in more places:

- **Lessons and reviews:** a small badge in the item header. In reviews it appears after you answer (configurable).
- **Item pages:** a badge next to the title and a *Difficulty* section.
- **Lesson picker:** a dot on every item, so you can mix easy and hard ones in a batch.
- **Level pages, dashboard, kanji/vocabulary lists:** a dot on every item.

[screenshot: review header badge + popover]

Hover over or click the badge to see where the item sits in its level, how many learners had it as their worst item, whether they got the **meaning or the reading** wrong, and **your own** accuracy and leech status.

[screenshot: lesson picker with dots]

### What changed in the calculation

It uses the same 2022 data (88,968 learners' worst kanji and vocab), but turns it into a difficulty differently:

- Items are ranked **within their level**, in four bands: the easiest 50% are *Easy*, then 25% *Medium*, 15% *Hard* and the hardest 10% *Very hard*. Before, one outlier per level squeezed most items into green.
- Every level shows a **confidence**: how well two random halves of the learners agree. It is high for early levels and lower for late ones, where fewer learners had arrived.
- **Your difficulty** comes from your own reviews (needs the Open Framework).
- Colorblind-safe and monochrome palettes. The bars are readable without color.

Details: [How difficulty is calculated](https://github.com/saraqael-m/WKItemDifficulty#how-difficulty-is-calculated)

### Install

Requires Tampermonkey; the [Open Framework](https://community.wanikani.com/t/instructions-installing-wanikani-open-framework/28549) is recommended.
[Install from Greasy Fork](https://greasyfork.org/scripts/457095-wanikani-item-difficulty). If you already have it, it updates by itself, and your review setting carries over.
