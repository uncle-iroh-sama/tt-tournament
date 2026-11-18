# Drabinka

Stół sędziego głównego do turnieju indywidualnego w tenisie stołowym, w układzie Grand Prix Wielkopolski (WZTS): eliminacje, losowanie turnieju głównego, mecze o miejsca i klasyfikacja z punktami KWGPP. Działa w przeglądarce, bez serwera. Zapis jest w tej przeglądarce; turniej przenosi się plikiem JSON.

## Jak prowadzić turniej

1. Otwórz aplikację. Zostaw język polski albo przełącz na angielski — wybór zostaje zapamiętany.
2. **Nowy turniej.** Podaj nazwę, datę, halę, kategorię, liczbę stołów, grę do (domyślnie 3 wygrane sety) i długość meczów o miejsca (domyślnie 2 wygrane sety). Wielkość turnieju głównego to 32, 16 albo 64. Rozstawieni bezpośrednio to osoby, które przy większej liczbie zgłoszeń wchodzą od razu do turnieju głównego (domyślnie 16).
3. Wybierz system eliminacji. **Bezpośrednia eliminacja** jest układem WZTS: gdy startujących jest więcej niż miejsc w turnieju głównym, najlepsi w rankingu wchodzą wprost, a reszta gra drabinkę pucharową (z wolnymi losami, do najbliższej potęgi dwójki), aż zapełnią się wolne miejsca. **Grupy** to wężyk, oficjalna kolejność meczów, punkty 2/1/0 i tie-break PZTS. Na pulpicie widać, ile rund to zajmie.
4. **Zawodnicy.** Dodawaj pojedynczo albo wklej listę. Wiersz: `Nazwisko Imię; Klub; 1450` albo `Nazwisko Imię; Klub; #12` (pozycja). Przed losowaniem można poprawiać i usuwać. W trakcie turnieju zostaje wycofanie: w grupie pozostałe mecze są anulowane, w pucharze przeciwnik dostaje walkower. Wycofany jest nieklasyfikowany.
5. **Rozlosuj eliminacje**, potem wpisuj wyniki na stronie Mecze. Wolne stoły można zapełnić jednym przyciskiem. Set jest do 11, z przewagą dwóch. Walkower i poddanie są obok wyniku. Drabinka uzupełnia się sama.
6. Po eliminacjach **losuj turniej główny**. Ten sam kod losowania i ta sama kolejność rankingu dają te same miejsca. W protokole widać tasowanie przedziałów i zamiany klubów. Zanim padnie pierwszy wynik, dwóch zawodników można zamienić ręcznie.
7. Włączone gry o miejsca (domyślnie 3. miejsce i 5–8) dają dokładną lokatę. Bez tego 9–16 jest jednym przedziałem, 17–32 dzieli się na 17–20, 21–24, 25–28 i 29–32, a przegrani eliminacji dostają 33–40, 41–48, 49–56 i dalej. Wycofany jest nieklasyfikowany (dyskw.) i nie dostaje punktów.
8. **Klasyfikacja** liczy punkty KWGPP dla wybranej kategorii. Tabelę można poprawić. Jest druk drabinki, kartek meczowych i klasyfikacji.
9. **Widok publiczny** jest tylko do odczytu i da się go otworzyć na telefonie. Eksport JSON przenosi cały turniej na inny komputer; import wczytuje go z powrotem.

Przycisk **Turniej demonstracyjny** wstawia 60 zawodników z klubów Wielkopolski (kod losowania `DEMO60`), żeby przejść cały przebieg od razu.

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
2. **New tournament.** Name, date, venue, category, number of tables, match length (best of 5 by default) and place-match length (best of 3 by default). The main draw is 32, 16 or 64. Direct seeds are the players who walk into the main draw when the field is larger (16 by default).
3. Choose qualifying. **Knock-out** is the WZTS arrangement: if there are more players than main-draw places, the best-ranked go straight through and the rest play a knock-out bracket, with byes, sized to the next power of two, until the remaining places are filled. **Groups** use a snake, the usual Polish match order, points 2/1/0 and the PZTS tie-break. The desk states how many rounds that takes.
4. **Players.** Add them one by one or paste a list. A line is `Family Given; Club; 1450` or `Family Given; Club; #12` for a ranking position. Edit and delete before the draw. During the event, withdraw: remaining group matches are cancelled, and in knock-out the opponent receives a walkover. A withdrawn player is not classified.
5. **Draw qualifying**, then enter results on Matches. One button fills the free tables. A set is to 11, won by two. Walkover and retirement sit next to the score. The bracket fills itself in.
6. After qualifying, **draw the main event**. The same draw code and the same ranking order reproduce the same slots. The draw record shows band shuffles and club swaps. Before any main-draw result, two players can be swapped by hand.
7. Place matches that are switched on (3rd place and places 5–8 by default) give an exact place. Otherwise 9–16 is one band, 17–32 splits into 17–20, 21–24, 25–28 and 29–32, and qualifying losers take 33–40, 41–48, 49–56 and onward. A player who withdraws is not classified and receives no points.
8. **Standings** award KWGPP points for the selected age category. The table can be edited. The draw, the match sheets and the classification can be printed.
9. **Public view** is read-only and comfortable on a phone. Export JSON to move the whole event; import reads it back.

**Demo tournament** loads 60 players from Wielkopolska clubs (draw code `DEMO60`) so the whole event can be tried immediately.

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
