# Reading a page on a known site

What the extension keeps and drops on the sites it has rules for. A rule names the parts of the page
that hold writing, so nav, bylines and widgets never reach the model. Everything inside a rule's
regions is still read by the general extraction in `src/page-text.js`, which drops buttons, forms,
link-only rows and hidden text.

Selectors were checked in a logged-out browser on 2026-11-12. Where a class name carries a hash
(`description__ej4leF`), the rule matches by structure or by heading text instead.

## What every rule relies on

A region is read as if it were the page: its own text counts, and the blocks inside it are read
deepest first, so a wrapper contributes only the text that none of its children already gave. On a
Steam guide that ordering is the difference between four blocks and twelve, because `.subSection`,
`.subSectionDesc` and their list items all nest.

The general exclusions stop at the edge of a region. A rule may name something the general pass would
throw away, like the rules of a subreddit, which live in an `aside`; that region is read anyway, and
inside it nav, forms and hidden text are still dropped. The same goes for the `class` and `id` words
that mark chrome: they are only read inside the region, because a card on Amazon sits in a
`.a-carousel-card` and a wrapper on GitHub may be called `header` for reasons of its own.

A highlight covers text that was read and nothing else. A block's text nodes carry a run number that
steps up wherever something unread sits between them, an image, a button or a code block, and the
marker is drawn once per run, so it never washes over a picture. On the Wikipedia article below, the
ranges that covered an image of a formula were 3 before that and 0 after, over 306 blocks.

## github.com

- Keep: `.markdown-body`. It is the readme (`article.markdown-body`), the body of an issue, a pull
  request or a discussion, every comment (`.comment-body.markdown-body`) and a rendered markdown file.
  Verified on a pull request (8 blocks, all of them writing), on a repository page and on a discussion
  thread.
- Keep: the repo description, which sits in a sidebar cell whose `h2` reads "About"
  (`p.description__ej4leF`). Class names are hashed, so find that `h2` by its text and take the `p`s
  in its parent. The page holds two copies of the cell, one for each width, and the general extraction
  drops whichever is not rendered.
- Drop: the timeline around those bodies. llama.cpp issue #1 goes from 116 blocks to 25 with the rule:
  the ones that go are the title, `Closed`, `Description`, `Activity`, `Member`, and a byline and a
  `Reacted by …` row for every comment. Pull request #1 is the same story at 371 blocks.
- Nothing inside a `.markdown-body` needs excluding.

## Steam

- Store page `store.steampowered.com/app/<id>`: `.game_description_snippet` (short description),
  `#game_area_description` ("About This Game"). Checked: nine blocks, all of them writing.
- Store reviews: the widget is `[data-featuretarget=appreviews]` and renders no cards logged out;
  review text is `.apphub_CardTextContent` on `steamcommunity.com/app/<id>/reviews/`, and it opens with
  a `Posted: <date>` line in `.date_posted` that has to go.
- Discussion topic `steamcommunity.com/app/<appid>/discussions/<forum>/<topic>/`: `.forum_op .content`
  for the first post, `.commentthread_comment_text` for the replies. The rest of `.forum_op` is the
  author header, with "View Profile" and "Posts" links. Checked: 129 blocks, all writing.
- Guide `sharedfiles/filedetails/?id=`: `.subSection` for the chapters and `.commentthread_comment_text`
  for the comments. `.guideTop` holds the title and the star rating, so it stays out, as does the
  chapter title `.subSectionTitle` on its own. Checked: 12 blocks, all writing.
- Workshop item, same URL shape: `.workshopItemTitle`, `.workshopItemDescription`, and
  `.commentthread_comment_text` for comments.
- Drop: `.bb_code`, which is Steam's code block and reads like the `code` and `pre` the general
  extraction already skips. Also the old page shell (`#global_header`, `#responsive_page_menu`,
  `.apphub_sectionTabs`, `.submenu_Store`) and collection and compatibility notices.

## amazon.com

- Keep: `#feature-bullets` ("About this item"), `#productDescription`, `#prodDetails` and
  `#detailBullets_feature_div` (product information). The store page shows them without a rule only
  after the page's own chrome is stripped.
- Keep: the review cards, `[data-hook=mobley-review-content]`, which is what Amazon renders now, plus
  `[data-hook=review]` and `.review-text-content` for the older layouts. Checked signed in on a water
  bottle: 43 blocks, the bullets, the description, the details, and each review's title and body,
  including the paragraphs of a long review.
- Drop, inside a card: `[data-hook=genome-widget]` (avatar and name), `[data-hook=review-star-rating]`,
  `[data-hook=review-by-line]` and `[data-hook=review-date]` ("Reviewed in the United States on
  November 3, 2026"), `[data-hook=format-strip]` ("Color: Off Road, Size: 24 Ounces"),
  `[data-hook=review-badges]`, `[data-hook=helpful-vote-statement]` ("11 people found this helpful"),
  `[data-hook=reviewActionBar]`, and the two `.a-teaser-describedby-*` divs, whose text is
  "Brief content visible, double tap to read full content". The card alone gives 57 blocks, 34 with
  those gone. Do not drop `[data-hook=reviewText]`: that is the deck that holds the visible body.
- Drop: `#reviewsMedley` as a whole. It mixes the rating histogram and the "Customers say" summary
  into the review list.
- A review card sits inside `.a-carousel-card`, so any check that walks all the way up a block's
  ancestors finds a `carousel` and throws the card away. This is why the general exclusions have to
  stop at the edge of a region.

## reddit.com

- Keep: `[slot=text-body]` (a text post's body, inside `shreddit-post-text-body`) and
  `[slot=comment]` (each comment, inside `shreddit-comment`). Checked on a text post: 24 blocks, all
  of them the post and its comments. Without a rule the same page gives 37 blocks and drags in a
  "Continue with Google" row, an ad's domain name and a chunk of `@font-face` CSS.
- Keep: the rules of the subreddit, as
  `aside.subreddit-right-rail-community-info faceplate-expandable-section-helper h2`. Only the titles
  are laid out: each rule is a closed `<details>`, so its description has no box until it is opened.
  The title sits in a numbered row, and reading the `h2` alone keeps the numbers out.
- Not found: the subreddit description. It is not in the DOM of a logged-out `/r/<sub>/` page, so a
  rule cannot read it.
- Drop: the right rail itself, which is an `aside` and holds ads, "More posts you may like" and
  "Related posts".

## youtube.com

- Keep: `#description-inline-expander` for the description and `#content-text` (inside
  `ytd-comment-thread-renderer` or `ytd-comment-view-model`) for the comments. Checked on a video:
  21 blocks, all writing.
- Drop: `#expand`, which is the "… more" button and reads as a block of its own ("more"), and
  `#description-inner` as a whole, because it starts with `#info`: view count, date and hashtags.
- The description is folded until it is opened, so only the part on screen is laid out and read.

## google.com/maps

- Keep: `.MyEned`, the wrapper around the text of a review. Checked on a restaurant with its reviews
  open: three blocks, the three reviews.
- Drop: `.wiI7pd` on its own. It is the class of the text inside `.MyEned`, and of the text of a
  "Response from the owner" too, and those responses open with "Hello <name>, A huge thank you for
  your review" from the business.
- Without a rule the place panel gives 71 blocks of chrome: reviewer names, `Local Guide · 41 reviews ·
  92 photos`, the star counts of the rating histogram, `+3`, `Like`.

## yelp.com

- Keep: the review bodies, which are `p` elements whose class starts with `comment__`
  (`[class^="comment__"], [class*=" comment__"]`). The hash after that prefix changes with every
  deploy, so this is the most fragile rule of the set, and without it the general pass still finds the
  reviews among a lot of noise: 163 blocks on a café's page, led by `Helpful 0`, `Thanks 0`,
  `Love this`, `Oh no` reaction chips, page numbers, "Review Highlights" quotes and "Sam B. said"
  testimonials from other businesses.
- Keep: nothing else on the page. `section[aria-label="Recommended Reviews"]` gets the review bodies,
  but also the "Select your rating", "Overall rating" and "5 stars" rows of the review form, and the
  photo captions inside reviews. With the `comment__` rule, ten reviews and no noise.

## bsky.app

- Keep: `[data-word-wrap="1"]`, the body of a post. It is the only stable hook in the markup: the
  classes are React Native Web's (`css-g5y9jx`, `r-8akbws`, new names on each deploy) and the
  `data-testid` differs per view. The feed wraps the body in `data-testid="postText"`, a thread puts
  no test id on the body at all (its items are `data-testid="postThreadItem-by-<handle>"`), and a
  profile has neither. `data-word-wrap` is on the body in all three, and on nothing else: on a feed,
  all 70 of them were inside a post.
- Drop: `[aria-label^="Post "]`, the `3/7` counter of a post that belongs to a thread. It sits inside
  the body, so without the rule the block ends in `3/7`. The `^` matters: `aria-label="Post by
  <handle>"` is on the card around a quoted post, and that card holds the quoted body.
- A feed of 48 posts: 47 blocks, because one post is a GIF with no writing, and 66 without the
  counter rule, one block per counter (`1/2`, `2/3`). A post that quotes another one gives its own
  body and the quoted body, so that feed came to 69 blocks, and two posts the feed showed twice did
  as well.
- A thread view: 16 blocks, the post and 15 replies, without their authors.
- A profile: 58 blocks, its posts. Where the app lays out the profile's own description, that is
  among them.
- Without a rule, the same feed gives 309 blocks of `ALT` badges (one per image), `GIF`, author names,
  handles, `· 6h`, `115`, `1K`, `9` and `Write your reply`; the thread gives 57 and the profile 320,
  nearly all of them `ALT`.

## Pages no rule covers, measured on a WordPress blog

ma.tt is the test case: a `[role=main]`, an `article` per post, `.entry-content` around the writing,
`.screen-reader-text` labels, `.sharedaddy` sharing, `.jp-relatedposts`, and the comment form. On
`/2026/10/standards/` the pass before these choices read 17 blocks, and 5 of them were the post and
the comments heading. The other 12 were the title, date and tags three times over (each in its own
wrapper), the sharing list, `Share this:`, `Related`, two related-post excerpts, and
`SHARE YOUR THOUGHTS Cancel reply`. The choices that fix it are the ones every site needs:

- Read inside `main, [role=main]` when the page has one, and the whole body when it does not. That
  container is what a site itself declares to be the writing.
- Drop anything whose `class` or `id` names it chrome, on a word boundary. The words are the ones
  sites reuse across themes and frameworks: `nav`, `menu`, `sidebar`, `breadcrumb`, `footer`,
  `header`, `masthead`, `toolbar`, `pagination`, `share`, `related`, `social`, `cookie`, `newsletter`,
  `subscribe`, `promo`, `banner`, `advert`, `sponsor`, `modal`, `popup`, `overlay`, `drawer`, `skip`,
  `screen-reader`, `visually-hidden`, `sr`, `respond`, `reply`, `submit`, `meta`, `byline`, `rating`,
  `vote`, `actions`, `search`, `widget`, `tab`, `carousel`, `slider`, `sticky`, `paywall`. Matched
  against whole words so `comment-content` and `.comments-title` stay, while `comment-reply-title`,
  `#respond` and `.comment-respond` go. The words of five letters and more also count as the start of
  a name, because themes run two together: `jp-relatedposts` and `sharedaddy` are caught that way.
  Shorter ones are whole words only, or `tab` would claim `table`.
- Treat `aside`, `[role=complementary]`, `dialog`, `[role=dialog]`, `[role=alert]`, `[inert]` and
  `[aria-modal=true]` the way nav and forms are treated now.

The same pass over a big page with a full sidebar, the article `Transformer (deep learning
architecture)` on Wikipedia: 306 blocks, 11,424 words, no menu item among them.

What the same pass does on two other sites with no rule:

- A Substack post (`[role=main]`, `.available-content`, `.body.markup`): 84 blocks, all of them the
  article, its image captions and the interview turns. The only extra is the `This post is for paid
  subscribers` heading where the free part ends.
- A Mastodon thread (`main`, one `article` per post): 28 blocks, the post and its replies. Two small
  leftovers: the `GIF` badge of a media attachment and `You've reached the end of the conversation`.

## Not done yet

- X puts a sign-in in the way, so it needs a session in the browser before its markup can be checked.
