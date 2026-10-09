# SimpleSynthSeq

En lille browserbaseret step-sequencer med indbygget FM-synth. Ingen afhængigheder ud over [Bun](https://bun.sh) til at serve filerne; al lyd genereres med Web Audio API direkte i browseren.

![SimpleSynthSeq afspiller et mønster, og synth-panelet for et spor åbnes](docs/demo.gif)

## Kom i gang

```bash
bun run dev
```

Åbn derefter <http://localhost:3000>. `dev` kører med hot reload, så ændringer i `app.js`, `style.css` og `index.html` vises med det samme. Brug `bun start` for at køre uden hot reload. Porten kan ændres med miljøvariablen `PORT`.

## Funktioner

- **Spor og mønster:** Kick, snare, hi-hat, piano, melodi og bas som udgangspunkt. Spor kan tilføjes, fjernes og ryddes, og mønsterlængden kan vælges (16, 32 eller 64 trin, eller hvad en MIDI-import kræver).
- **FM-synth pr. spor:** Klik på et sporsnavn for at redigere bære- og modulatorbølge, mod. ratio/index, pitch- og amplitude-envelopes, støjfilter, panorering og volumen. Presets dækker trommer, klaver, orgel, guitar, strygere, blæsere, pads m.m.
- **Akkordmode:** Et spor kan spille en akkord på hvert tændt trin. Akkordtype, toner, grundtone og oktav vælges i panelet, og enkelte trin kan få deres egen tone eller akkord via højreklik.
- **Groove:** Global swing samt mikro-timing pr. trin (nudge).
- **Effekter:** Delay og algoritmisk reverb som sends pr. spor.
- **MIDI-import:** Indlæs en Standard MIDI File via toolbaren. General MIDI-programmer og -percussion mappes til passende presets, og hele filen importeres (mønsterlængden vokser efter behov). Prøv den medfølgende `example.mid`.
- **Afspilning:** Mellemrum starter og stopper. Klik eller træk i linealen for at flytte afspilningspositionen. Mute og solo pr. spor.

## Filer

| Fil | Indhold |
| --- | --- |
| `index.html` | Toolbar, sequencer-grid og hjælpetekst |
| `app.js` | Sequencer, FM-synth, effekter, MIDI-parser og UI |
| `style.css` | Mørkt tema og layout |
| `server.js` | Bun-server med HTML-bundling og hot reload |
| `example.mid` | Lille MIDI-fil til at afprøve importen |
