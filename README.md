# romeoville-events-portrait-display

Responsive event list for Yodeck-style signage.  
**Container size:** 1080 × 960  
- Filters out past events
- Shows title, date, time, location
- Paginates (12 events per page by default)
- 20s per page
- Cap of 32 upcoming events
- Hourly soft data refresh
- Hard reload a few seconds after midnight

## Files
- `index.html` – shell
- `style.css` – layout & styles
- `script.js` – data loading, filtering, pagination, refresh
- `events.json` – data source (array of events)

## Data format
Use either:
```json
{ "title": "Event Name", "start": "2025-08-22T18:00:00-05:00", "end": "2025-08-22T20:00:00-05:00", "location": "Venue" }
