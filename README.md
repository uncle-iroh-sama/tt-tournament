# Drabinka

Stół sędziego głównego do turnieju indywidualnego w tenisie stołowym, w układzie Grand Prix Wielkopolski (WZTS): eliminacje, losowanie turnieju głównego, mecze o miejsca i klasyfikacja z punktami KWGPP. Działa w przeglądarce, bez serwera. Zapis jest w tej przeglądarce; turniej przenosi się plikiem JSON.

## Jak prowadzić turniej

1. Otwórz aplikację. Zostaw język polski albo przełącz na angielski — wybór zostaje zapamiętany.
2. **Nowy turniej.** Podaj nazwę, datę, halę, kategorię, liczbę stołów, grę do (domyślnie 3 wygrane sety) i długość meczów o miejsca (domyślnie 2 wygrane sety). Wielkość turnieju głównego to 8, 16, 32 albo 64. Rozstawieni bezpośrednio to osoby, które przy większej liczbie zgłoszeń wchodzą od razu do turnieju głównego (domyślnie połowa drabinki; co najmniej jedno miejsce zostaje dla eliminacji).
3. Wybierz system rozgrywek i rodzaj drabinki. Drabinka **bez gier o miejsca** kończy się na finale; **gry o miejsca w obrębie rundy** to dotychczasowe mecze przegranych z tej samej rundy; **pocieszenie z dołączaniem (WZTS)** to drabinka jak na kartkach WZTS: przegrani 1. rundy grają między sobą, przegrani każdej dalszej rundy (poza finałem) dołączają do zwycięzców pocieszenia, więc przegrany z 1/8 może jeszcze zająć 3. miejsce. Przegrani każdej rundy pocieszenia grają o swój przedział aż do ostatniego miejsca. Mecz o miejsca, którego nie rozegrano (NIE), oznacza się jako nierozegrany — jego zawodnicy dzielą miejsca, o które grali. System **pucharowy** jest układem WZTS: gdy startujących jest więcej niż miejsc w turnieju głównym, najlepsi w rankingu wchodzą wprost, a reszta gra drabinkę pucharową (z wolnymi losami, do najbliższej potęgi dwójki), aż zapełnią się wolne miejsca. **Grupy** to wężyk, oficjalna kolejność meczów, punkty 2/1/0 i tie-break PZTS. **Każdy z każdym** to jedna grupa ze wszystkimi zawodnikami, terminarzem po kolejkach i tabelą, która po ostatnim meczu jest klasyfikacją końcową; drabinki nie ma. W grupach liczy się ITTF: 2 punkty za wygraną, 1 za rozegraną porażkę, 0 za walkower lub poddanie, a przy remisie punkty, potem stosunek setów, potem małych punktów w meczach między remisującymi. Na pulpicie widać, ile rund to zajmie. W krótkim pliku to `settings.format` (`knockout`, `groups`, `roundRobin`) i `settings.bracket` (`single`, `placement`, `consolation`).
4. **Zawodnicy.** Dodawaj pojedynczo albo wklej listę. Wiersz: `Nazwisko Imię; Klub; 1450` albo `Nazwisko Imię; Klub; #12` (pozycja). Przed losowaniem można poprawiać i usuwać. W trakcie turnieju zostaje wycofanie: w grupie pozostałe mecze są anulowane, w pucharze przeciwnik dostaje walkower. Wycofany jest nieklasyfikowany.
5. **Rozlosuj eliminacje**, potem wpisuj wyniki na stronie Mecze. Wolne stoły można zapełnić jednym przyciskiem. Set jest do 11, z przewagą dwóch. Walkower i poddanie są obok wyniku. Drabinka uzupełnia się sama.
6. Po eliminacjach **losuj turniej główny**. Ten sam kod losowania i ta sama kolejność rankingu dają te same miejsca. W protokole widać tasowanie przedziałów i zamiany klubów. Zanim padnie pierwszy wynik, dwóch zawodników można zamienić ręcznie.
7. Włączone gry o miejsca (domyślnie 3. miejsce i 5–8) dają dokładną lokatę. Bez tego 9–16 jest jednym przedziałem, 17–32 dzieli się na 17–20, 21–24, 25–28 i 29–32, a przegrani eliminacji dostają 33–40, 41–48, 49–56 i dalej. Wycofany jest nieklasyfikowany (dyskw.) i nie dostaje punktów.
8. **Klasyfikacja** liczy punkty KWGPP dla wybranej kategorii. Tabelę można poprawić. Jest druk drabinki, kartek meczowych i klasyfikacji.
9. **Widok publiczny** jest tylko do odczytu i da się go otworzyć na telefonie. Eksport JSON przenosi cały turniej na inny komputer; import wczytuje go z powrotem.

Przycisk **Turniej demonstracyjny** wstawia 60 zawodników z klubów Wielkopolski (kod losowania `DEMO60`), żeby przejść cały przebieg od razu.

## Plik JSON i turniej na żywo

Zapis jest zwykłym JSON-em w wersji 1. Pełny eksport (przycisk **Eksportuj JSON**) to stan turnieju: ustawienia, zawodnicy, mecze i wyniki. Taki plik można włożyć do `public/live/<nazwa>.json` i opublikować razem ze stroną. Widok `#/live/<nazwa>` pobiera ten plik, odświeża go co pół minuty i pokazuje drabinkę, wyniki, klasyfikację i wyszukiwanie. Na pulpicie **Otwórz opublikowany turniej** wczytuje ten sam plik jako turniej do prowadzenia, a **Kopiuj link** daje adres widoku publicznego. Przykład: `public/live/demo.json`, adres `#/live/demo`.

Krótszy plik da się napisać ręcznie ze zdjęć kartek. Wystarczą zawodnicy i, gdy pierwsza runda jest już rozlosowana na papierze, pary. `ranking` to punkty rankingowe; `ranking: "#12"` albo `rankingPosition` to miejsce na liście. `b: null` (albo `"bye"`) to wolny los. Kolejność par jest kolejnością drabinki: zwycięzca pierwszej pary gra ze zwycięzcą drugiej. W parach muszą być dokładnie ci, którzy grają tę rundę — przy eliminacjach bez rozstawionych bezpośrednio, przy pełnej stawce wszyscy. Nazwisko ma być takie jak na liście; wielkość liter i polskie znaki nie przeszkadzają.

```json
{
  "version": 1,
  "settings": { "name": "Grand Prix Kalisz", "date": "2026-11-21", "format": "knockout", "bracket": "placement", "mainDrawSize": 32, "directSeeds": 16 },
  "players": [
    { "name": "Kowalski Jan", "club": "KU AZS Poznań", "ranking": 1480 },
    { "name": "Nowak Piotr", "club": "UKS Joker Śrem", "ranking": 1410 }
  ],
  "fixedFirstRound": [
    { "a": "Kowalski Jan", "b": "Nowak Piotr" },
    { "a": "Zieliński Marek", "b": null }
  ]
}
```

Pary dotyczą pierwszej rundy, która naprawdę się odbywa: eliminacji, gdy zgłoszonych jest więcej niż miejsc w turnieju głównym, a w przeciwnym razie turnieju głównego. Dalsze rundy, mecze o miejsca i klasyfikacja liczą się same. Przy systemie grupowym pary z kartki nie obowiązują.

## Prowadzenie z telefonu

Na hali zostaje telefon. Wynik przychodzi SMS-em (`Kowalski - Nowak 3:1`, albo sety `11:7 9:11 11:5 11:8`, albo zdjęcie kartki). Ten, kto ma repozytorium, wpisuje go w terminalu i wypycha `public/live/<nazwa>.json`. Widok na żywo czyta ten sam plik.

```bash
npm run tt -- init kalisz kalisz.json
npm run tt -- init kalisz kalisz.json --bracket single --draw 16
npm run tt -- status kalisz
npm run tt -- result kalisz "Kowalski" "Nowak" 3:1
npm run tt -- result kalisz "Kowalski Jan" "Nowak Piotr" "11:7 9:11 11:5 11:8"
npm run tt -- result kalisz "Zieliński Marek" "Wójcik Anna" wo
npm run tt -- undo kalisz "Kowalski" "Nowak"
npm run tt -- skip kalisz "Kowalski" "Nowak"
npm run tt -- draw-main kalisz
npm run tt -- draw-main kalisz --fixed pary.json
npm run tt -- player add kalisz "Lis Robert" "KS Energetyk Poznań" 1100
npm run tt -- player rename kalisz "Lis Robert" "Lis Robert Jan"
npm run tt -- player remove kalisz "Lis Robert Jan"
```

`init` bierze krótki plik (`--format`, `--bracket` i `--draw` nadpisują jego ustawienia), losuje eliminacje lub układa terminarz grupy (albo zostawia turniej przed losowaniem, gdy eliminacji nie ma) i zapisuje pełny stan. Pierwszy podany zawodnik jest stroną A wyniku: `3:1` i `11:7` liczą się z jego perspektywy. `wo` to walkower, wygrywa pierwszy. Nazwisko wystarczy, gdy jest jedno; kolejność członów i polskie znaki nie przeszkadzają. `undo` cofa wynik tylko wtedy, gdy nikt dalej już na nim nie zagrał. `skip` oznacza mecz o miejsca jako nierozegrany (NIE); `undo` to cofa. `player` działa przed losowaniem. Miejsce na liście podaj w cudzysłowie (`"#12"`), bo `#` obcina resztę polecenia. Każdy zapis podbija `updatedAt`.

## Uruchomienie

```bash
npm install
npm run dev
```

Aplikacja wstaje na [http://127.0.0.1:4178](http://127.0.0.1:4178). Testy: `npm test`. Build do `dist/`: `npm run build` (ścieżki są względne, więc katalog można wystawić z dowolnego podkatalogu). Push do `main` uruchamia `.github/workflows/pages.yml`: testy, build i publikacja `dist/` na GitHub Pages.

## Założenia

Punkty to kolumna KWGPP z PZTS 18.4, dla seniorów, juniorów, kadetów, młodzików i żaków. Skrzat nie ma tej kolumny: skala „Własna” jest pusta, dopóki sędzia jej nie wpisze. KWIMP (mistrzostwa województwa) to inna skala i nie jest wpisana.

Kolejność w grupie zależy od liczby awansujących (PZTS 5.2.1). Przy czterech osobach i dwóch awansach: 1–3 i 2–4, potem 1–2 i 3–4, na końcu 1–4 i 2–3. Remis rozstrzyga mała tabela (przy trzech i więcej), a gdy kryteria milczą — losowanie z kodu.

Rozstawienie jest z rankingu. Losowanie w przedziałach można włączyć w ustawieniach. Zawodnicy jednego klubu nie grają ze sobą w pierwszej rundzie, jeśli da się ich rozsunąć, a rozstawieni 1–8 z jednego klubu trafiają do przeciwnych połówek.

Wycofany rozstawiony albo kwalifikant zostawia wolny los. Nikt z dalszego miejsca nie wchodzi na jego pozycję. Gry o miejsca liczą się w chwili losowania; zmiana przełączników wymaga cofnięcia i ponownego losowania. Mecze o miejsca idą do ustawionej długości, reszta do długości turnieju.

---

# Draw

A chief referee’s desk for an individual table-tennis tournament run the way Wielkopolska Grand Prix events are run: qualifying, a seeded main draw, place matches and a final classification with KWGPP points. It is a browser app with no server. The save lives in this browser; a JSON file carries the tournament to another machine.

## Running an event

1. Open the app. Polish is the default; the language switch is remembered.
2. **New tournament.** Name, date, venue, category, number of tables, match length (best of 5 by default) and place-match length (best of 3 by default). The main draw is 8, 16, 32 or 64. Direct seeds are the players who walk into the main draw when the field is larger (half the draw by default; qualifying always keeps at least one place).
3. Choose the format and the knock-out style. **Single elimination** ends at the final; **place matches within each round** are the same-round loser matches; **feed-in consolation (WZTS)** is the bracket on the WZTS sheets: first-round losers play each other, losers of every later round except the final drop in against the consolation winners, so a round-of-16 loser can still finish 3rd. Each consolation round's losers play out their own band down to the last place. A place match that was not played (NIE) can be marked as such, and its players share the places it would have decided. **Knock-out** is the WZTS arrangement: if there are more players than main-draw places, the best-ranked go straight through and the rest play a knock-out bracket, with byes, sized to the next power of two, until the remaining places are filled. **Groups** use a snake, the usual Polish match order, points 2/1/0 and the PZTS tie-break. **Round robin** is one group with every player, a schedule by rounds and a table that becomes the final classification after the last match; there is no bracket. Group tables follow ITTF: 2 points for a win, 1 for a played loss, 0 for a walkover or retirement loss, and ties go to match points, then set ratio, then point ratio in the matches between the tied players. The desk states how many rounds that takes. In a short file these are `settings.format` (`knockout`, `groups`, `roundRobin`) and `settings.bracket` (`single`, `placement`, `consolation`).
4. **Players.** Add them one by one or paste a list. A line is `Family Given; Club; 1450` or `Family Given; Club; #12` for a ranking position. Edit and delete before the draw. During the event, withdraw: remaining group matches are cancelled, and in knock-out the opponent receives a walkover. A withdrawn player is not classified.
5. **Draw qualifying**, then enter results on Matches. One button fills the free tables. A set is to 11, won by two. Walkover and retirement sit next to the score. The bracket fills itself in.
6. After qualifying, **draw the main event**. The same draw code and the same ranking order reproduce the same slots. The draw record shows band shuffles and club swaps. Before any main-draw result, two players can be swapped by hand.
7. Place matches that are switched on (3rd place and places 5–8 by default) give an exact place. Otherwise 9–16 is one band, 17–32 splits into 17–20, 21–24, 25–28 and 29–32, and qualifying losers take 33–40, 41–48, 49–56 and onward. A player who withdraws is not classified and receives no points.
8. **Standings** award KWGPP points for the selected age category. The table can be edited. The draw, the match sheets and the classification can be printed.
9. **Public view** is read-only and comfortable on a phone. Export JSON to move the whole event; import reads it back.

**Demo tournament** loads 60 players from Wielkopolska clubs (draw code `DEMO60`) so the whole event can be tried immediately.

## Tournament file and the live view

The save is version-1 JSON. A full export (**Export JSON**) is the tournament state: settings, players, matches and results. Put that file at `public/live/<slug>.json` and publish it with the site. `#/live/<slug>` fetches the file, refreshes it about every half minute, and shows the draw, the results, the classification and player search. On the desk, **Open published tournament** loads the same file as the working event, and **Copy link** gives the public address. The example is `public/live/demo.json`, at `#/live/demo`.

A shorter file can be written by hand from photographs of the paper. Players are enough, plus the pairs when the first round has already been drawn. `ranking` is ranking points; `ranking: "#12"` or `rankingPosition` is a place on the list. `b: null` (or `"bye"`) is a bye. Pair order is bracket order: the winner of the first pair meets the winner of the second. The pairs must be exactly the players in that round — everyone except the direct seeds, when there is qualifying, otherwise the whole field. The name is the one on the player list; letter case and Polish diacritics do not matter.

```json
{
  "version": 1,
  "settings": { "name": "Grand Prix Kalisz", "date": "2026-11-21", "format": "knockout", "bracket": "placement", "mainDrawSize": 32, "directSeeds": 16 },
  "players": [
    { "name": "Kowalski Jan", "club": "KU AZS Poznań", "ranking": 1480 },
    { "name": "Nowak Piotr", "club": "UKS Joker Śrem", "ranking": 1410 }
  ],
  "fixedFirstRound": [
    { "a": "Kowalski Jan", "b": "Nowak Piotr" },
    { "a": "Zieliński Marek", "b": null }
  ]
}
```

The pairs are the first round that is actually played: qualifying, when the entry is larger than the main draw, and the main draw otherwise. Later rounds, place matches and the classification follow on their own. Paper pairings do not apply to a group event.

## Running it from a phone

At the venue there is only a phone. A result arrives as a text (`Kowalski - Nowak 3:1`, or the sets `11:7 9:11 11:5 11:8`, or a photo of the sheet). Whoever has the repository types it in and pushes `public/live/<slug>.json`. The live view reads that file.

```bash
npm run tt -- init kalisz kalisz.json
npm run tt -- init kalisz kalisz.json --bracket single --draw 16
npm run tt -- status kalisz
npm run tt -- result kalisz "Kowalski" "Nowak" 3:1
npm run tt -- result kalisz "Kowalski Jan" "Nowak Piotr" "11:7 9:11 11:5 11:8"
npm run tt -- result kalisz "Zieliński Marek" "Wójcik Anna" wo
npm run tt -- undo kalisz "Kowalski" "Nowak"
npm run tt -- skip kalisz "Kowalski" "Nowak"
npm run tt -- draw-main kalisz
npm run tt -- draw-main kalisz --fixed pary.json
npm run tt -- player add kalisz "Lis Robert" "KS Energetyk Poznań" 1100
npm run tt -- player rename kalisz "Lis Robert" "Lis Robert Jan"
npm run tt -- player remove kalisz "Lis Robert Jan"
```

`init` reads the short file (`--format`, `--bracket` and `--draw` override its settings), draws qualifying or the group schedule (or leaves the event undrawn when qualifying is not needed) and writes the full state. The first player named is side A of the score: `3:1` and `11:7` are from that player's point of view. `wo` is a walkover won by the first name. A surname is enough when only one player has it; token order and Polish diacritics do not matter. `undo` clears a result only when no later match has been played off it. `skip` marks a place match as not played (NIE); `undo` takes that back. `player` works before the draw. Quote a ranking place (`"#12"`), because `#` cuts off the rest of the command. Every save bumps `updatedAt`.

## Develop

```bash
npm install
npm run dev
```

The app serves at [http://127.0.0.1:4178](http://127.0.0.1:4178). Tests: `npm test`. Build into `dist/` with `npm run build`. Asset paths are relative, so the folder can be hosted from any subpath. A push to `main` runs `.github/workflows/pages.yml`: tests, the build, and a publish of `dist/` to GitHub Pages.

## Assumptions

Points are the KWGPP column of PZTS 18.4, for seniors, juniors, cadets, młodzik and żak. Skrzat has no column there: the Custom scale stays empty until the referee fills it. KWIMP (provincial championships) is a different scale and is not included.

Group order follows how many players advance (PZTS 5.2.1). With four players and two advancing: 1–3 with 2–4, then 1–2 with 3–4, then 1–4 with 2–3. A tie goes to the mini-table when three or more are level, and to a draw from the draw code when the criteria stay silent.

Seeding follows the ranking. A draw within bands can be switched on. Players from one club do not meet in the first round when they can be separated, and seeds 1–8 from one club are placed in opposite halves.

A withdrawn direct seed or qualifier leaves a bye. The next player is not promoted. Place-match switches are read when the draw is made; changing them means clearing the draw and making it again. Place matches use their own length; every other match uses the tournament length.
