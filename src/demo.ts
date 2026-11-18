import { addPlayer, createTournament, defaultSettings } from './logic/engine.ts'
import type { Tournament } from './logic/types.ts'

const ROWS: [string, string][] = [
  ['Kowalski Marek', 'KU AZS Poznań'],
  ['Nowak Piotr', 'KU AZS Poznań'],
  ['Wiśniewski Adam', 'KU AZS Poznań'],
  ['Wójcik Tomasz', 'KU AZS Poznań'],
  ['Kamiński Jakub', 'KU AZS Poznań'],
  ['Lewandowski Filip', 'KU AZS Poznań'],
  ['Zieliński Michał', 'KU AZS Poznań'],
  ['Szymański Bartosz', 'KU AZS Poznań'],
  ['Woźniak Kacper', 'UKS Joker Śrem'],
  ['Dąbrowski Jan', 'UKS Joker Śrem'],
  ['Kozłowski Antoni', 'UKS Joker Śrem'],
  ['Jankowski Hubert', 'UKS Joker Śrem'],
  ['Mazur Oliwier', 'UKS Joker Śrem'],
  ['Kwiatkowski Igor', 'UKS Joker Śrem'],
  ['Krawczyk Szymon', 'MLKS Górnik Konin'],
  ['Piotrowski Franciszek', 'MLKS Górnik Konin'],
  ['Grabowski Leon', 'MLKS Górnik Konin'],
  ['Nowicki Aleksander', 'MLKS Górnik Konin'],
  ['Pawłowski Nikodem', 'MLKS Górnik Konin'],
  ['Michalski Tymon', 'MLKS Górnik Konin'],
  ['Adamczyk Marcel', 'KS Unia Swarzędz'],
  ['Dudek Stanisław', 'KS Unia Swarzędz'],
  ['Zając Krzysztof', 'KS Unia Swarzędz'],
  ['Wieczorek Mikołaj', 'KS Unia Swarzędz'],
  ['Jabłoński Dawid', 'KS Unia Swarzędz'],
  ['Król Maciej', 'UKS Olimpijczyk Leszno'],
  ['Majewski Patryk', 'UKS Olimpijczyk Leszno'],
  ['Olszewski Wojciech', 'UKS Olimpijczyk Leszno'],
  ['Jaworski Rafał', 'UKS Olimpijczyk Leszno'],
  ['Malinowski Sebastian', 'UKS Olimpijczyk Leszno'],
  ['Pawlak Grzegorz', 'UKS Olimpijczyk Leszno'],
  ['Witkowski Andrzej', 'KS Polonia Kępno'],
  ['Walczak Dominik', 'KS Polonia Kępno'],
  ['Stępień Mateusz', 'KS Polonia Kępno'],
  ['Górski Łukasz', 'KS Polonia Kępno'],
  ['Rutkowski Karol', 'KS Polonia Kępno'],
  ['Sikora Adrian', 'KS Start Pleszew'],
  ['Ostrowski Damian', 'KS Start Pleszew'],
  ['Baran Kamil', 'KS Start Pleszew'],
  ['Duda Przemysław', 'KS Start Pleszew'],
  ['Szewczyk Marcin', 'KS Start Pleszew'],
  ['Tomaszewski Paweł', 'MLKS Piast Gostyń'],
  ['Pietrzak Alan', 'MLKS Piast Gostyń'],
  ['Marciniak Borys', 'MLKS Piast Gostyń'],
  ['Wróbel Cezary', 'MLKS Piast Gostyń'],
  ['Zalewski Julian', 'MLKS Piast Gostyń'],
  ['Jarosz Maksymilian', 'UKS Sokół Pniewy'],
  ['Bąk Natan', 'UKS Sokół Pniewy'],
  ['Chmielewski Oskar', 'UKS Sokół Pniewy'],
  ['Borkowski Radosław', 'UKS Sokół Pniewy'],
  ['Sokołowski Arkadiusz', 'KS Energetyk Poznań'],
  ['Sawicki Konrad', 'KS Energetyk Poznań'],
  ['Lis Robert', 'KS Energetyk Poznań'],
  ['Kubiak Daniel', 'KS Energetyk Poznań'],
  ['Kaczmarek Artur', 'KS Energetyk Poznań'],
  ['Urbański Miłosz', 'MKS Jutrzenka Warta'],
  ['Sikorski Fabian', 'MKS Jutrzenka Warta'],
  ['Krupa Tadeusz', 'MKS Jutrzenka Warta'],
  ['Włodarczyk Ignacy', 'MKS Jutrzenka Warta'],
  ['Czarnecki Bruno', 'MKS Jutrzenka Warta'],
]

export function demoTournament(): Tournament {
  const today = new Date().toISOString().slice(0, 10)
  let t = createTournament(
    {
      ...defaultSettings(),
      name: 'Grand Prix Wielkopolski — turniej demonstracyjny',
      date: today,
      venue: 'Hala sportowa, ul. Starołęcka, Poznań',
      category: 'senior',
      pointsCategory: 'senior',
      tables: 12,
      bestOf: 5,
      placeMatchBestOf: 3,
      mainDrawSize: 32,
      directSeeds: 16,
      qualifyingMode: 'knockout',
      groupSize: 4,
      advancePerGroup: 2,
      places: {
        third: true,
        fiveToEight: true,
        nineToSixteen: false,
        seventeenToThirtyTwo: false,
        nonQualifiers: false,
      },
    },
    'DEMO60',
  )
  ROWS.forEach(([name, club], i) => {
    const points = i === 20 ? 2400 - 19 * 28 : 2400 - i * 28
    t = addPlayer(t, {
      id: `demo-${i + 1}`,
      name,
      club,
      rankingPoints: points,
      rankingPosition: i + 1,
    })
  })
  return t
}

export function isDemoTournament(t: Tournament): boolean {
  return t.drawCode === 'DEMO60' && t.players.some((p) => p.id.startsWith('demo-'))
}

export function parsePlayerLines(text: string): { name: string; club: string; rankingPoints: number | null; rankingPosition: number | null }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const bits = (line.includes('\t') || line.includes(';') ? line.split(/\t|;/) : line.split(',')).map((s) => s.trim()).filter((s) => s.length > 0)
      const name = bits[0] ?? ''
      const club = bits[1] ?? ''
      const third = bits[2] ?? ''
      let rankingPoints: number | null = null
      let rankingPosition: number | null = null
      if (third) {
        if (/^(#|poz\.?|m\.)/i.test(third)) {
          const n = Number(third.replace(/[^\d]/g, ''))
          if (Number.isFinite(n)) rankingPosition = n
        } else {
          const n = Number(third.replace(/[^\d]/g, ''))
          if (Number.isFinite(n)) {
            if (n >= 100) rankingPoints = n
            else rankingPosition = n
          }
        }
      }
      return { name, club, rankingPoints, rankingPosition }
    })
    .filter((p) => p.name.length > 0)
}
