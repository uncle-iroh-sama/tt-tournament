# Drabinka

Stół sędziego głównego do turnieju indywidualnego w tenisie stołowym, w układzie Grand Prix Wielkopolski (WZTS): eliminacje, losowanie turnieju głównego, mecze o miejsca i klasyfikacja z punktami KWGPP. Działa w przeglądarce, bez serwera. Zapis jest w tej przeglądarce; turniej przenosi się plikiem JSON.

## Jak prowadzić turniej

1. Otwórz aplikację. Zostaw język polski albo przełącz na angielski — wybór zostaje zapamiętany.
2. **Nowy turniej.** Podaj nazwę, datę, halę, kategorię, liczbę stołów, grę do (domyślnie 3 wygrane sety) i długość meczów o miejsca (domyślnie 2 wygrane sety). Wielkość turnieju głównego to 32, 16 albo 64. Rozstawieni bezpośrednio to osoby, które przy większej liczbie zgłoszeń wchodzą od razu do turnieju głównego (domyślnie 16).
3. Wybierz system eliminacji. **Bezpośrednia eliminacja** jest układem WZTS: gdy startujących jest więcej niż miejsc w turnieju głównym, najlepsi w rankingu wchodzą wprost, a reszta gra drabinkę pucharową (z wolnymi losami, do najbliższej potęgi dwójki), aż zapełnią się wolne miejsca. **Grupy** to wężyk, oficjalna kolejność meczów, punkty 2/1/0 i tie-break PZTS. Na pulpicie widać, ile rund to zajmie.
4. **Zawodnicy.** Dodawaj pojedynczo albo wklej listę. Wiersz: `Nazwisko Imię; Klub; 1450` albo `Nazwisko Imię; Klub; #12` (pozycja). Przed losowaniem można poprawiać i usuwać. W trakcie turnieju zostaje wycofanie: w grupie pozostałe mecze są anulowane, w pucharze przeciwnik dostaje walkower. Wycofany jest nieklasyfikowany.
5. **Rozlosuj eliminacje**, potem wpisuj wyniki na stronie Mecze. Wolne stoły można zapełnić jednym przyciskiem. Set jest do 11, z przewagą dwóch. Walkower i poddanie są obok wyniku. Drabinka uzupełnia się sama.
6. Po eliminacjach **losuj turniej główny**. Ten sam kod losowania i ta sama kolejność rankingu dają te same miejsca. W protokole widać tasowanie przedziałów i zamiany klubów. Zanim padnie pierwszy wynik, dwóch zawodników można zamienić ręcznie.
7. Włączone gry o miejsca (domyślnie 3. miejsce i przedział 5–8) dają dokładną lokatę. Wyłączony przedział dostaje wspólny zakres i punkty tego zakresu.
8. **Klasyfikacja** liczy punkty KWGPP dla wybranej kategorii. Tabelę można poprawić. Jest druk drabinki, kartek meczowych i klasyfikacji.
9. **Widok publiczny** jest tylko do odczytu i da się go otworzyć na telefonie. Eksport JSON przenosi cały turniej na inny komputer; import wczytuje go z powrotem.

Przycisk **Turniej demonstracyjny** wstawia 60 zawodników z klubów Wielkopolski (kod losowania `DEMO60`), żeby przejść cały przebieg od razu.

## Uruchomienie

```bash
npm install
npm run dev
```

Aplikacja wstaje na [http://127.0.0.1:4178](http://127.0.0.1:4178). Testy: `npm test`. Build do `dist/`: `npm run build` (ścieżki są względne, więc katalog można wystawić z dowolnego podkatalogu, także GitHub Pages).

## Założenia

Regulamin WZTS 2025/26 nie publikuje tabeli punktów. Skala domyślna seniorów bierze opublikowane liczby KW GPP Pomorskiego WZTS (miejsca 1–11 i przedziały 3–4, 5–6, 7–8, 5–8, 9–10, 11–12, 9–12). Miejsce 12 jest dobrane tak, by przedział 11–12 był średnią. Dalsze miejsca i pozostałe kategorie są przeskalowane od miejsca 1. (młodzieżowiec i masters: 80). Tabelę zmienia się w klasyfikacji.

Kolejność meczów w grupie czteroosobowej to 1–4 i 2–3, potem 1–3 i 2–4, na końcu 1–2 i 3–4. Regulamin zostawia kolejność sędziemu; ta jest domyślna. Przy pełnym remisie o kolejności decyduje losowanie z kodu, nie los na sali.

Rozstawienie idzie aktualnym rankingiem: najpierw punkty, przy równych punktach niższa pozycja. Jednakowe punkty i pozycja są losowane. Zawodnicy jednego klubu nie spotykają się w pierwszej rundzie, o ile da się ich rozsunąć bez ruszania wolnych losów. Rozstawieni 1–4 nie są ruszani, jeśli jest inne rozwiązanie.

Wycofany rozstawiony albo kwalifikant zostawia wolny los. Nikt z dalszego miejsca nie wchodzi na jego pozycję. Gry o miejsca liczą się w chwili losowania; zmiana przełączników wymaga cofnięcia i ponownego losowania. Mecze o miejsca idą do ustawionej długości, reszta do długości turnieju.

---

# Draw

A chief referee’s desk for an individual table-tennis tournament run the way Wielkopolska Grand Prix events are run: qualifying, a seeded main draw, place matches and a final classification with KWGPP points. It is a browser app with no server. The save lives in this browser; a JSON file carries the tournament to another machine.

## Running an event

1. Open the app. Polish is the default; the language switch is remembered.
2. **New tournament.** Name, date, venue, category, number of tables, match length (best of 5 by default) and place-match length (best of 3 by default). The main draw is 32, 16 or 64. Direct seeds are the players who walk into the main draw when the field is larger (16 by default).
3. Choose qualifying. **Knock-out** is the WZTS arrangement: if there are more players than main-draw places, the best-ranked go straight through and the rest play a knock-out bracket, with byes, sized to the next power of two, until the remaining places are filled. **Groups** use a snake, the usual Polish match order, points 2/1/0 and the PZTS tie-break. The desk states how many rounds that takes.
4. **Players.** Add them one by one or paste a list. A line is `Family Given; Club; 1450` or `Family Given; Club; #12` for a ranking position. Edit and delete before the draw. During the event, withdraw: remaining group matches are cancelled, and in knock-out the opponent receives a walkover. A withdrawn player is not classified.
5. **Draw qualifying**, then enter results on Matches. One button fills the free tables. A set is to 11, won by two. Walkover and retirement sit next to the score. The bracket fills itself in.
6. After qualifying, **draw the main event**. The same draw code and the same ranking order reproduce the same slots. The draw record shows band shuffles and club swaps. Before any main-draw result, two players can be swapped by hand.
7. Place matches that are switched on (3rd place and places 5–8 by default) give an exact place. A switched-off band shares a range and that band’s points.
8. **Standings** award KWGPP points for the selected age category. The table can be edited. The draw, the match sheets and the classification can be printed.
9. **Public view** is read-only and comfortable on a phone. Export JSON to move the whole event; import reads it back.

**Demo tournament** loads 60 players from Wielkopolska clubs (draw code `DEMO60`) so the whole event can be tried immediately.

## Develop

```bash
npm install
npm run dev
```

The app serves at [http://127.0.0.1:4178](http://127.0.0.1:4178). Tests: `npm test`. Build into `dist/` with `npm run build`. Asset paths are relative, so the folder can be hosted from any subpath, including GitHub Pages.

## Assumptions

The WZTS 2025/26 regulations do not publish a points table. The default senior scale uses the published Pomeranian WZTS KW GPP figures (places 1–11 and the bands 3–4, 5–6, 7–8, 5–8, 9–10, 11–12, 9–12). Place 12 is chosen so the 11–12 band is their average. Later places and the other categories are scaled from first place (U21 and masters anchors are 80). Edit the table from the classification.

In a group of four the match order is 1–4 with 2–3, then 1–3 with 2–4, then 1–2 with 3–4. The regulations leave the order to the referee; this is the default. A tie that the criteria cannot break is drawn from the draw code, not by a fresh lot in the hall.

Seeding follows the current ranking: points first, then the lower ranking position. Equal points and position are drawn. Players from one club are kept apart in the first round when that can be done without moving a bye. Seeds 1–4 stay put when another swap exists.

A withdrawn direct seed or qualifier leaves a bye. The next player is not promoted. Place-match switches are read when the draw is made; changing them means clearing the draw and making it again. Place matches use their own length; every other match uses the tournament length.
