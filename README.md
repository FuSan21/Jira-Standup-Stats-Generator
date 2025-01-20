# Jira Standup Stats Generator

A Tampermonkey script that adds a statistics panel to JIRA for tracking ticket progress and generating standup reports.

## Features

### 1. Statistics Types

- **Daily Statistics**: Shows tickets completed on a specific date
- **Weekly Statistics**: Shows ticket progress over different week periods (current week, last week, up to 4 weeks ago)

### 2. Configurable Settings

The script allows customization of:

- Current User: The JIRA username to track
- Complete Status From: The starting status for completion tracking (e.g., "In Progress")
- Complete Status To: The target status for completion tracking (e.g., "Ready for Peer Review")
- In Progress Statuses: List of statuses considered as "in progress"

Settings are persisted in local storage for convenience.

### 3. Calculations and Logic

#### Daily Statistics

- **Total Tickets**: Count of tickets that changed from "Complete Status From" to "Complete Status To" on the selected date
- **Points Completed**: Sum of story points from completed tickets

#### Weekly Statistics

- **Carryover Tickets**: Tickets assigned to the user before the week started (determined using JIRA Changelog API)
- **New Tickets**: Tickets assigned to the user during the selected week (determined using JIRA Changelog API)
- **Completed Tickets**: Total tickets that moved to completion status during the week
- **Bug Tickets**: Count of completed tickets marked as bugs
- **User Story Tickets**: Count of completed tickets that are not bugs
- **Total Points**: Sum of story points from all tickets
- **Completed Points**: Same as total points (all tickets in results are completed)

### 4. API and Query Logic

The script uses multiple JIRA APIs to gather comprehensive ticket data:

#### Main Ticket Query (JQL)

```sql
assignee WAS currentUser()
AND status changed FROM "{completeStatusFrom}" TO "{completeStatusTo}"
DURING (startOfWeek(), endOfWeek())
AND status NOT IN ("{inProgressStatus1}", "{inProgressStatus2}")
```

#### Changelog API Usage

For weekly statistics, the script uses JIRA's Changelog API (`/rest/api/3/issue/{key}/changelog`) to:

1. Fetch the complete history of each ticket
2. Find the exact timestamp when the ticket was assigned to the user
3. Compare this timestamp with the week boundaries to classify the ticket as:
   - **Carryover**: Assignment date < week start date
   - **New**: Week start date ≤ Assignment date < week end date

This provides accurate tracking of when tickets entered your workload, regardless of their current status.

#### Daily Query

```sql
assignee WAS currentUser()
AND status changed FROM "{completeStatusFrom}" TO "{completeStatusTo}"
ON "{date}"
AND status NOT IN ("{inProgressStatus1}", "{inProgressStatus2}")
```

### 5. Features

- Copy formatted statistics for standup reports
- Settings persistence in local storage
- Visual feedback for actions (saving settings, copying stats)
- Error handling and loading states
- Responsive UI that matches JIRA's design

## Installation

### 1. Install Tampermonkey

#### Chrome

1. Visit the [Tampermonkey Chrome Web Store page](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
2. Click "Add to Chrome"
3. Click "Add extension" in the popup

#### Edge

1. Enable Developer Mode:
   - Click the three dots menu (⋯) > Extensions
   - Toggle on "Developer mode" in the bottom left
2. Visit the [Tampermonkey Edge Add-ons page](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
3. Click "Get" and then "Add extension"

#### Firefox

1. Visit the [Tampermonkey Firefox Add-ons page](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
2. Click "Add to Firefox"
3. Click "Add" in the popup

### 2. Install the Script

1. Click this link to install the script: [Install JIRA Stats](https://raw.githubusercontent.com/FuSan21/Jira-Standup-Stats-Generator/refs/heads/main/jira-stats.user.js)
2. Tampermonkey will open a new tab showing the script
3. Click the "Install" or "Update" button
4. Ensure the script is enabled:
   - Click the Tampermonkey icon
   - Check that "JIRA Stats" is listed and has a checkmark

The script will automatically check for and install updates when they're available.

### 3. Configure Browser Settings

#### Chrome/Edge Developer Mode

If the script doesn't work:

1. Go to Extensions (chrome://extensions/ or edge://extensions/)
2. Enable "Developer mode" in the top right (Chrome) or bottom left (Edge)
3. Refresh the extensions page
4. Refresh your JIRA page

### 4. Initial Setup

1. Visit your JIRA page
2. Look for the statistics icon in the JIRA header
3. Click the gear icon (⚙️) to open settings
4. Configure your settings:
   - Enter your JIRA username
   - Set your workflow statuses
   - Click Save

### 5. Troubleshooting

If the script doesn't work:

1. Check that Tampermonkey is enabled
2. Ensure the script is enabled in Tampermonkey
3. Try refreshing the JIRA page
4. Clear browser cache if needed
5. Check browser console for any error messages

## Usage

1. Click the statistics icon in JIRA's header
2. Select report type (Daily/Weekly)
3. Choose date or week period
4. Click Refresh to generate statistics
5. Use the copy button (📋) to copy formatted stats for standup reports

## Notes

- The script tracks ticket transitions between specified statuses
- Carryover/new ticket classification uses the Changelog API to determine exact assignment dates
- Story points are summed from the custom field in JIRA
- All data is fetched using JIRA's APIs with proper authentication
- Settings are stored locally in the browser
- Weekly statistics require additional API calls to fetch changelog data for accurate ticket classification
