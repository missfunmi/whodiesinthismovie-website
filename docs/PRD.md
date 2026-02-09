A frequent problem I have is this: when the tension in a particular movie or TV show I'm watching gets to be too intense, I often feel an urge to find out which character dies (or if a particular character dies) so I can get that tension out of the way immediately rather than let it continue to build and thus ruin my ability to enjoy or even finish the movie.

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
- **A single search bar:** Where the user can type a movie name, and autocomplete suggestions in the search results are returned that match as they type. User can press enter or click to select the top choice or use their arrow keys to navigate up/down through the autocomplete suggestions. Autocomplete shows max 8 suggestions. If query matches >100 movies (e.g. "the"), show message "Too many matches - keep typing!" Searches match anywhere in title (partial word matching enabled). Movie names in the autocomplete search results should be prefixed with the poster image and suffixed with the year in parentheses. For example, "\<poster> Sinners (2025)"
- **Movie Detail Page**: Upon selecting a movie name, a page is shown with the movie metadata and character deaths list. 
	- Movie detail page shows: poster image, title, year, director, tagline (if available), runtime, and MPAA rating. Do not include budget, box office, or full cast list
	- Character death cards containing Character Name | Time of Death (timestamp or act/scene) | Cause of Death | Killed By (person/entity or "N/A" for accidents/natural causes) | Surrounding Context (brief summary of the situation that led to character's death)
  - The list of characters who die (as well as the count of characters, whether 0 or > 0) is hidden by default but can be clicked to unhide. ´
	- Upon clicking, the list will be revealed as well as all the information about when/how they die. If no deaths, a peppy message like "No deaths! Everyone survives! 🥳" is presented instead
	- Ambiguous deaths shown in a separate section below confirmed deaths, with grayed-out text and a '?' icon next to the character name, along with the detail surrounding the particular ambiguity
- **All Movies Browse Page**: A dedicated page showing all movies in the database. 
	Displays movies in alphabetical order (A-Z) in a grid layout with poster thumbnails. Movies added in the last 24 hours show a "NEW!" badge. Pagination with 100 movies per page. Filter/sort options: alphabetical (default) or recently added. Clicking a movie poster navigates to that movie's detail page
- **Dynamic Movie Ingestion System**: When a user searches for a movie not in the database and the search returns zero results → show "We don't have that one yet! Want us to look it up?" text link. Clicking the link triggers background ingestion process. System validates query is a real movie name (using LLM) before processing. Background worker fetches movie metadata from TMDB API. Worker scrapes character death data from List of Deaths wiki / The Movie Spoiler (see data sources below). Worker uses LLM to extract and structure death data. Movie is added to database once processing complete. User receives notification when movie is available.
	- Handles edge cases:
		- Concurrent requests for same movie (deduplicates by TMDB ID)
		- Multiple TMDB matches (takes first result)
		- Failed lookups (retries with exponential backoff, logs to console)
		- Non-English titles (validates but doesn't transliterate)
- **Real-time Notification System**: Alerts users when new movies are added. Notification bell icon in top-right corner of all pages. Badge shows count of unread notifications. Clicking bell reveals dropdown with last 5 movie additions. Each notification shows: movie title (linked to detail page) + "NEW!" badge + timestamp. Notifications persist across page refreshes (stored in localStorage). Frontend polls for new additions every 60 seconds. "Mark all as read" action clears badge and dismisses notifications. Clicking a notification link dismisses it automatically and navigates to movie page
- Has basic input validation
- Meets standard accessibility requirements — color contrast, screen reader support, keyboard navigable
- Deployed and running on localhost for initial demos

### Nice to have - Time-permitting only, otherwise future scope:

- **Easter Egg - Natural Language Query (RAG-based)**: Prefacing search with "!!" lets users bypass movie search and type a plain text query. For example, "!! do the twins die in sinners". Pressing enter triggers a call to a local LLM with RAG to extract meaning from the query, retrieve information from the database, and return a natural language answer (Yes/No/"The movie leaves us hanging!"). This feature lets users find out if a specific character dies without getting spoilers about other characters' deaths.
	- User: "!! do the twins die in sinners?"
	- RAG retrieves: death data for the twins from Sinners
	- LLM generates and returns some variation of: "Elijah (Smoke) dies, but Elias (Stack) turns into a vampire and lives forever. \[Show more details?]"
	- Additional RAG response examples for tone consistency:
		- "Yep, \[Character] kicks the bucket in Act 2 around the 51 minute mark. Shot by \[Killer]. \[Show details?]"
		- "Nope! \[Character] makes it to the credits unscathed."
		- "The movie leaves us hanging - \[Character]'s fate is ambiguous. \[Show details?]"
- Site hosting on Vercel at the purchased domain: i.e. whodiesinthismovie.com
- Site is responsive and built as a progressive web app
- More comprehensive input validation and sanitization
- Dedicated shareable URL to the movie, e.g. whodiesinthismovie.com/movies/sinners(2025)

### Data sources:

- Movie metadata:
	- For MVP: Manually seed database with ~100 movies. Include mix of high-death-count films (action, horror) and low/zero-death films (drama, comedy) to test both cases. Movie metadata sourced from The Movie Database API: https://developer.themoviedb.org/docs/getting-started and stored in a JSON file (data/seed-movies.json)
	- Post-MVP: Build scraping pipeline for RateYourMusic (RYM) top films 2024-2026, working backwards from 2026: https://rateyourmusic.com/charts/top/film/2026
- Character deaths information priority sources (in order):
	1. List of Deaths fandom wiki: https://listofdeaths.fandom.com/wiki/List_of_Deaths_Wiki
	2. The Movie Spoiler: https://themoviespoiler.com
	3. Wikipedia plot summaries
- Check each site's robots.txt before scraping. For MVP, manually curate deaths data for the hardcoded list of ~100 movies serving as the seed for the database and store in a JSON file (data/seed-deaths.json) to unblock development. Dynamic ingestion system handles additional movies post-seeding.

### Definitely out of scope for MVP - future *future* scope:

- Support for TV shows by overall show as well as individually by episode
- Continuous ingestion pipeline for new movies, movies older than the initial cutoff (i.e. 2024), and less popular or international movies not present on RYM lists
- Ability for users to contribute directly on the site new information about deaths spoilers and for that information to be validated (e.g. by other users or by cross-verifying against new data sources, etc.)
- ... Others I can't think of now

### Technology preferences:

- Core website: 
	- Stack: Next.js / Node using TypeScript and Tailwind
	- Database: Local Postgres with Prisma ORM
	- Build/hosting: Vercel (entire stack runs on Next.js for MVP, no separate Python service)
	- LLM: Ollama running Llama 3.2 3B (for query validation and death data extraction)
	- Queue System: Database-based polling queue (no Redis/BullMQ for MVP)
	- Notifications: Polling-based (60-second interval), localStorage persistence
	- Logging: Sentry
