# Forum post draft (for saraqael's thread)

> Draft for the first post of https://community.wanikani.com/t/userscript-item-difficulty-indicator/59876, or a reply in it. Screenshots go where marked.

---

## Item Difficulty Indicator v2: a modernized Item Difficulty 🟢🟡🟠🔴

v2 of saraqael's original script, as a separate Greasy Fork script. It uses the same 2022 data; the original stopped matching the current WaniKani UI and showed most items as green, so the display and the calculation were rebuilt. It is a separate script because the original author prefers not to host LLM-generated code (see the disclosure below).

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

- **Compared with everything up to your level**, not just the item's own level. A model corrects for the fact that people mostly name something they learned recently as their worst item: about 12 times more often than an item from 10+ levels back.
- Four bands: the easiest 50% are *Easy*, then 25% *Medium*, 15% *Hard* and the hardest 10% *Very hard*.
- **Honest about thin data.** Every item has a likely range. When the range covers most of the scale, it says *Not enough data* instead of pretending an item with no votes is easy.
- **Your difficulty**, ranked against the other items you've reviewed, plus a leech tag (needs the Open Framework).
- Colorblind-safe and monochrome palettes. The bars are readable without color.

Details: [How difficulty is calculated](https://github.com/pensiero/WKItemDifficulty#how-difficulty-is-calculated)

### Install

Requires Tampermonkey; the [Open Framework](https://community.wanikani.com/t/instructions-installing-wanikani-open-framework/28549) is recommended.
[Install from Greasy Fork](GREASYFORK_URL). It is a separate script from the original, so disable the original first; your review setting carries over.

**LLM disclosure:** this version was written with substantial help from an LLM (Claude Code), then reviewed and tested by me.
