A frequent problem I have is this: when the tension in a particular movie or TV show I’m watching gets to be too intense, I often feel an urge to find out which character dies (or if a particular character dies) so I can get that tension out of the way immediately rather than let it continue to build and thus ruin my ability to enjoy or even finish the movie.

I'd like to build a website where you can look up a movie or a TV show and then see all the characters who die in the movie, when, how, and by whose hand. I've already purchased the domain: whodiesinthismovie.com.

### Must have - Core features:

- A fun, welcome page with movie posters faded in the background and a rotating sequence of peppy taglines: 
	- "Find out who bites the dust so you don't have to bite your nails! 💅"
	- "Ruin movie night and spoil the ending for everyone! 😃"  
	- "Because sometimes knowing is better than wondering! 😇"
	- "Spoil the ending, save your sanity! 🎬"
	- "Death comes for everyone... but now you'll know when! ⏰"
	- "Know the ending before the anxiety ending! 🫠"
	- "Spoilers: now 100% guilt-free! ✨"
	- "Your therapist will thank us! 🧠"
	- "Plot armor? Not in our database! 🛡️"
	- "We do the hard watching so you don't have to! 👀"
- A single search bar where the user can type a movie name, and autocomplete suggestions in the search results are returned that match as they type. User can press enter or click to select the top choice or use their arrow keys to navigate up/down through the autocomplete suggestions. Autocomplete shows max 8 suggestions. If query matches >100 movies (e.g. "the"), show message "Too many matches - keep typing!" Searches match anywhere in title (partial word matching enabled).
- Movie names in the autocomplete search results should be prefixed with the poster image and suffixed with the year in parentheses. For example, "\<poster> Sinners (2025)"
- Upon selecting a movie name, a page is shown with the movie metadata and character deaths list. 
	- Movie detail page shows: poster image, title, year, director, tagline (if available), runtime, and MPAA rating. Do not include budget, box office, or full cast list
	- Character death cards containing Character Name | Time of Death (timestamp or act/scene) | Cause of Death | Killed By (person/entity or "N/A" for accidents/natural causes) | Surrounding Context (brief summary of the situation that led to character's death)
- The list of characters who die (as well as the count of characters, whether 0 or > 0) is hidden by default but can be clicked to unhide. ´
	- Upon clicking, the list will be revealed as well as all the information about when/how they die. If no deaths, a peppy message like "No deaths! Everyone survives! 🥳" is presented instead
	- Ambiguous deaths shown in a separate section below confirmed deaths, with grayed-out text and a '?' icon next to the character name, along with the detail surrounding the particular ambiguity
- Has basic input validation
- Meets standard accessibility requirements — color contrast, screen reader support, keyboard navigable
- Deployed and running on localhost for initial demos

### Must have - Easter egg features:

- Prefacing their search with a special keyword will let users bypass the movie search and type a plain text query. Special keyword is "!!" For example, "*!! do the twins die in sinners*". This query naturally will not return autocomplete suggestions in the drop down but pressing enter will trigger a call to a local LLM to extract meaning from the query, extract the information from the data in our database, and return a Yes, No, or "The movie leaves us hanging!" (or some puny/funny variations of the same sentiment). This easter egg will let the user find out if a specific character dies without getting spoilers about other character's deaths.
	- User: "!! do the twins die in sinners?"
	- RAG retrieves: death data for the twins from Sinners
	- LLM generates and returns some variation of: "Elijah (Smoke) dies, but Elias (Stack) turns into a vampire and lives forever. \[Show more details?]". Additional RAG response examples for tone consistency:
		- "Yep, \[Character] kicks the bucket in Act 2 around the 51 minute mark. Shot by \[Killer]. \[Show details?]"
		- "Nope! \[Character] makes it to the credits unscathed."
		- "The movie leaves us hanging - \[Character]'s fate is ambiguous. \[Show details?]"

### Nice to have - Time-permitting only, otherwise future scope:

- Site hosting on Vercel at the purchased domain: i.e. whodiesinthismovie.com
- Site is responsive and built as a progressive web app
- More comprehensive input validation and sanitization
- Failure/fallback: If a user searches for a movie whose deaths we have not yet scraped/ingested, add an option to look it up in real time. E.g. user types "Sinners", 
	- If we've ingested the movie's metadata but not movie deaths data, we show it in the autocomplete results perhaps in a different color to indicate deaths information is missing. If the user selects it in the dropdown, we let the user know we don't have the deaths information yet and ask if they want to look it up now? Then in realtime go scrape and fetch the deaths information for that movie - perhaps show a spinner while that happens
	- If we haven't ingested the movie's metadata yet, show a message during the search to the effect of "We don't have that one yet! Send us a message and we'll look it up later!" and maybe trigger a message to add it to queue (using that word loosely) to ingest that later
- Dedicated shareable URL to the movie, e.g. whodiesinthismovie.com/movies/sinners(2025)

### Data sources:

- Movie metadata:
	- For MVP: Manually seed database with 15 movies from 2024-2026 top lists. Include mix of high-death-count films (action, horror) and low/zero-death films (drama, comedy) to test both cases. Movie metadata sourced from The Movie Database API: https://developer.themoviedb.org/docs/getting-started
	- Post-MVP: Build scraping pipeline for RateYourMusic (RYM) top films 2024-2026, working backwards from 2026: https://rateyourmusic.com/charts/top/film/2026 
- Character deaths information priority sources (in order):
	1. List of Deaths fandom wiki: https://listofdeaths.fandom.com/wiki/List_of_Deaths_Wiki
	2. The Movie Spoiler: https://themoviespoiler.com
	3. Wikipedia plot summaries (as fallback)
- Check each site's robots.txt before scraping. For MVP, manually curate deaths data for 15 popular movies from 2024-2026 and store in a JSON file (data/seed-deaths.json) to unblock development. Build automated scraping post-MVP.

### Definitely out of scope for MVP - future *future* scope:

- Support for TV shows by overall show as well as individually by episode
- Continuous ingestion pipeline for new movies, movies older than the initial cutoff (i.e. 2024), and less popular or international movies not present on RYM lists
- Ability for users to contribute directly on the site new information about deaths spoilers and for that information to be validated (e.g. by other users or by cross-verifying against new data sources, etc.)
- Ability to notify users when a movie they searched for but we didn't have information about at the time has been ingested
- ... Others I can't think of now

### Technology preferences:

- Core website: 
	- Stack: Next.js / Node using TypeScript and Tailwind
	- Database: Local Postgres with Prisma ORM
	- Build/hosting: Vercel
	- LLM: Ollama running Llama 3.2 3B
	- Logging: Sentry
- RAG pipeline: 
	- Python (in a separate project) with Ollama, Sentence Transformers, ChromaDB, uv virtual env
