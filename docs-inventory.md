# Swish Sports – Public Feature Inventory (2026-10-15)
Sources: swishsportsapp.com (home, /recreational-play, /pickeball-club-management, /pricing), swishtournaments.com/help-center, App Store id1551295361 / Google Play co.lincolnlabs.swish listing text, r/Pickleball reviews (see SWISH_RESEARCH_AND_MVP.md). Screenshots/YouTube not reviewed frame-by-frame; inferred screens marked (inf).

## Game formats
| # | Format | Behavior |
|---|---|---|
| F1 | Rotating-partner round robin (individual) | New partner each round, minimize repeats, byes rotate |
| F2 | Set-partner round robin | Fixed teams rotate opponents |
| F3 | Mixed-gender round robin | Each team = 1 M + 1 F, rotating |
| F4 | Team / MLP-style (4-player teams, 2M+2F) and custom team sizes 3/4/6/8 | Teams play team-vs-team; sub-matches |
| F5 | King of the Court ("Up and Down the River") | Winners move up a court, losers down every game; partners split |
| F6 | Ladder league (rotating partner style) | Seeded courts; weekly/round reshuffle winners up/losers down; most wins = champion |
| F7 | Tournament / playoffs | Bracket seeded from leaderboard after N rounds |
| F8 | Seeding vs randomization | Seed by rating or random initial courts |

## Organizer features
O1 Event setup: date/time, location, courts, capacity · O2 Any number of players/courts · O3 Automated court assignments + matchups per round · O4 Customize/override assignments · O5 Add/remove players mid-event, matchups adjust · O6 Score entry per court (Swish locks across courts – we don't) · O7 Live leaderboard (wins, point diff) · O8 Configurable number of rounds · O9 Duplicate recurring games · O10 Multi-week league copy · O11 DUPR ID on profile + DUPR upload (rec/club weighted) · O12 Manual add players · O13 Multiple admins · O14 Groups, invites, chat, DMs, friends · O15 Upcoming games/invites list · O16 Registration & payments (SwishTournaments.com) · O17 Booking-system API · O18 Swish AI (scope unknown)

## Inferred screens
Login · Home (upcoming/invites) · Groups/chat · Create game · Format wizard · Live courts board · Score entry · Leaderboard · Bracket · Profile (DUPR) · Paywall · Admin

## Out of scope for a private friend-group app
O13, O14 chat, O16 payments, O17, O18, DUPR API upload (needs partner approval → CSV export instead).
