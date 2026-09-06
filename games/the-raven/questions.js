/* THE RAVEN — "Nevermore"
 * The question bank. Every question is answered "Nevermore."
 *   safe: true  → "never" is a mercy (the question asks about a torment)
 *   safe: false → "never" is ruin   (the question asks about a hope)
 *   tier 1: plain, one clause.   tier 2: two clauses, subtler nouns.
 *   tier 3: double negatives ("two nevers make a yes") and "Is there a … that will not …" traps.
 *   gloss: what the Raven's word means here — shown to the player after the pick, so nothing is unfair twice.
 */
export const QUESTIONS = [
  // ───────────── TIER 1 · SAFE ─────────────
  { q: 'Will this grief return?',                       safe: true,  tier: 1, gloss: 'It will not return.' },
  { q: 'Shall I hear that rapping again?',              safe: true,  tier: 1, gloss: 'You shall not hear it again.' },
  { q: 'Will the tempest break my shutters?',           safe: true,  tier: 1, gloss: 'The shutters hold.' },
  { q: 'Shall my sorrow deepen?',                       safe: true,  tier: 1, gloss: 'It deepens no further.' },
  { q: 'Will the darkness take my sight?',              safe: true,  tier: 1, gloss: 'Your eyes are spared.' },
  { q: 'Shall I weep again tonight?',                   safe: true,  tier: 1, gloss: 'No more tears tonight.' },
  { q: 'Will the fever come again?',                    safe: true,  tier: 1, gloss: 'The fever is done.' },
  { q: 'Shall I dread the midnight hour?',              safe: true,  tier: 1, gloss: 'Midnight loses its terror.' },
  { q: 'Will this madness master me?',                  safe: true,  tier: 1, gloss: 'You keep your reason.' },
  { q: 'Shall the dead come rapping at my door?',       safe: true,  tier: 1, gloss: 'The dead stay quiet.' },
  { q: 'Shall my enemies rejoice?',                     safe: true,  tier: 1, gloss: 'They shall not.' },
  { q: 'Will the embers burn my hand?',                 safe: true,  tier: 1, gloss: 'The hand is spared.' },
  { q: 'Shall I lose my reason?',                       safe: true,  tier: 1, gloss: 'Your reason stays.' },
  { q: 'Shall this dread outlast the night?',           safe: true,  tier: 1, gloss: 'The dread dies with the night.' },
  { q: "Will the Raven's shadow swallow me?",           safe: true,  tier: 1, gloss: 'The shadow stops short.' },
  { q: 'Shall my nightmares wake me?',                  safe: true,  tier: 1, gloss: 'You sleep through.' },
  { q: 'Will the wound bleed again?',                   safe: true,  tier: 1, gloss: 'The wound is closed.' },
  { q: 'Shall the ghost upon the floor rise up?',       safe: true,  tier: 1, gloss: 'It lies still.' },
  { q: 'Will the cold creep further in?',               safe: true,  tier: 1, gloss: 'The cold stops here.' },
  { q: 'Shall the silence mock me?',                    safe: true,  tier: 1, gloss: 'The silence is only silence.' },

  // ───────────── TIER 1 · RUIN ─────────────
  { q: 'Is there — is there balm in Gilead?',           safe: false, tier: 1, gloss: 'There is no balm.' },
  { q: 'Shall I see Lenore again?',                     safe: false, tier: 1, gloss: 'You shall not see her.' },
  { q: 'Will the morning come?',                        safe: false, tier: 1, gloss: 'No morning.' },
  { q: 'Will the angels give me rest?',                 safe: false, tier: 1, gloss: 'No rest.' },
  { q: 'Shall my heart be mended?',                     safe: false, tier: 1, gloss: 'It stays broken.' },
  { q: 'Will the lamp burn until dawn?',                safe: false, tier: 1, gloss: 'The lamp goes out.' },
  { q: 'Shall I sleep tonight?',                        safe: false, tier: 1, gloss: 'No sleep.' },
  { q: 'Will my friends come knocking?',                safe: false, tier: 1, gloss: 'Other friends have flown before.' },
  { q: 'Shall the sun rise on this chamber?',           safe: false, tier: 1, gloss: 'No sun.' },
  { q: 'Will she remember me in Aidenn?',               safe: false, tier: 1, gloss: 'She will not remember.' },
  { q: 'Shall I clasp a sainted maiden whom the angels name Lenore?', safe: false, tier: 1, gloss: 'You shall not clasp her.' },
  { q: 'Will this cup of sorrow pass?',                 safe: false, tier: 1, gloss: 'The cup stays full.' },
  { q: 'Shall I laugh again?',                          safe: false, tier: 1, gloss: 'No laughter.' },
  { q: 'Will the spring return to my garden?',          safe: false, tier: 1, gloss: 'No spring.' },
  { q: 'Shall my prayers be heard?',                    safe: false, tier: 1, gloss: 'They are not heard.' },
  { q: 'Will you leave my chamber, bird?',              safe: false, tier: 1, gloss: 'It never leaves.' },
  { q: 'Shall I find respite and nepenthe?',            safe: false, tier: 1, gloss: 'No respite.' },
  { q: 'Will hope come rapping at my door?',            safe: false, tier: 1, gloss: 'Hope does not knock.' },
  { q: 'Is there mercy for a broken heart?',            safe: false, tier: 1, gloss: 'No mercy.' },
  { q: 'Tell me — shall my name be spoken kindly?',     safe: false, tier: 1, gloss: 'Not kindly. Not ever.' },
  { q: 'Wretch, hath thy God lent thee respite?',       safe: false, tier: 1, gloss: 'No respite is lent.' },

  // ───────────── TIER 2 · SAFE ─────────────
  { q: 'Shall I hear her footsteps and find no one there?',        safe: true,  tier: 2, gloss: 'The phantom steps are silenced.' },
  { q: 'Will the memory of her sting as it stings tonight?',       safe: true,  tier: 2, gloss: 'The sting is over.' },
  { q: 'Shall I come to fear the sound of my own name?',           safe: true,  tier: 2, gloss: 'Your name stays your own.' },
  { q: 'Will the tapping at the lattice grow louder?',             safe: true,  tier: 2, gloss: 'It grows no louder.' },
  { q: 'Shall my hand tremble when I write her name?',             safe: true,  tier: 2, gloss: 'The hand is steady.' },
  { q: 'Will the bells toll for me before I am ready?',            safe: true,  tier: 2, gloss: 'Not before you are ready.' },
  { q: 'Shall the shadow that sits there follow me abroad?',       safe: true,  tier: 2, gloss: 'It stays on the floor.' },
  { q: 'Will the embers die and leave me in the cold?',            safe: true,  tier: 2, gloss: 'The embers keep.' },
  { q: 'Shall I be haunted by that dreaming eye?',                 safe: true,  tier: 2, gloss: 'The eye lets you be.' },
  { q: 'Will the wind moan through the shutters as it moans tonight?', safe: true, tier: 2, gloss: 'The wind falls quiet.' },
  { q: 'Will my nights hereafter be as this night?',               safe: true,  tier: 2, gloss: 'No night like this again.' },
  { q: 'Shall I be mocked by every knock upon my door?',           safe: true,  tier: 2, gloss: 'A knock is only a knock.' },
  { q: 'Will the silence of this room grow heavier?',              safe: true,  tier: 2, gloss: 'It grows no heavier.' },
  { q: 'Shall the fear that grips me tighten its hold?',           safe: true,  tier: 2, gloss: 'Its hold loosens.' },
  { q: 'Will you perch upon my chamber door tomorrow as tonight?', safe: true,  tier: 2, gloss: 'Not tomorrow.' },
  { q: 'Shall I mistake the curtain’s rustle for her step again?', safe: true, tier: 2, gloss: 'No more mistakes.' },
  { q: 'Will your one word drive me mad?',                         safe: true,  tier: 2, gloss: 'Your wits survive it.' },

  // ───────────── TIER 2 · RUIN ─────────────
  { q: 'Shall I ever forget her, and be at peace?',                safe: false, tier: 2, gloss: 'No forgetting. No peace.' },
  { q: 'Will she come again with the spring, and find me here?',   safe: false, tier: 2, gloss: 'She does not come.' },
  { q: 'Shall the bird depart and leave my bust in peace?',        safe: false, tier: 2, gloss: 'The bird stays.' },
  { q: 'Will the lamp-light warm me as it warmed us both?',        safe: false, tier: 2, gloss: 'No warmth.' },
  { q: 'Shall I hear her voice once more upon the stair?',         safe: false, tier: 2, gloss: 'Not once more.' },
  { q: 'Will a kinder guest come knocking after you?',             safe: false, tier: 2, gloss: 'No kinder guest.' },
  { q: 'Shall my tears run dry and my sleep return?',              safe: false, tier: 2, gloss: 'Neither.' },
  { q: 'Will the morrow bring an ending to this vigil?',           safe: false, tier: 2, gloss: 'The vigil has no end.' },
  { q: 'Shall my soul be lifted from this floor?',                 safe: false, tier: 2, gloss: 'It is not lifted.' },
  { q: 'Will you tell me she is happy, and be gone?',              safe: false, tier: 2, gloss: 'It tells you nothing, and stays.' },
  { q: 'Shall the memory of her comfort me instead of wound me?',  safe: false, tier: 2, gloss: 'It only wounds.' },
  { q: 'Will this December end, and April come?',                  safe: false, tier: 2, gloss: 'No April.' },
  { q: 'Shall I learn to love another?',                           safe: false, tier: 2, gloss: 'No other.' },
  { q: 'Will you speak another word than that?',                   safe: false, tier: 2, gloss: 'Only that word.' },
  { q: 'Shall the dawn find me sleeping?',                         safe: false, tier: 2, gloss: 'No sleep, and no dawn.' },
  { q: 'Quaff, oh quaff this kind nepenthe — shall I then forget?', safe: false, tier: 2, gloss: 'No forgetting.' },
  { q: 'Will the door open on a face I love?',                     safe: false, tier: 2, gloss: 'It opens on darkness there.' },

  // ───────────── TIER 3 · SAFE (two nevers make a yes; "is there a … that will not …") ─────────────
  { q: 'Shall I never cease to hear her footsteps?',     safe: true,  tier: 3, gloss: 'Two nevers: you shall cease to hear them.' },
  { q: 'Will this grief never leave me?',                safe: true,  tier: 3, gloss: 'Two nevers: the grief leaves.' },
  { q: 'Shall I never sleep again?',                     safe: true,  tier: 3, gloss: 'Two nevers: you shall sleep.' },
  { q: 'Will the shadow never lift from off the floor?', safe: true,  tier: 3, gloss: 'Two nevers: the shadow lifts.' },
  { q: 'Shall I never be free of you, bird?',            safe: true,  tier: 3, gloss: 'Two nevers: you go free.' },
  { q: 'Will the morning never come?',                   safe: true,  tier: 3, gloss: 'Two nevers: the morning comes.' },
  { q: 'Shall I nevermore be glad?',                     safe: true,  tier: 3, gloss: 'Two nevers: you shall be glad.' },
  { q: 'Is there a grief that will not pass?',           safe: true,  tier: 3, gloss: 'No such grief: every grief passes.' },
  { q: 'Is there a fear I cannot master?',               safe: true,  tier: 3, gloss: 'No such fear: you master them all.' },
  { q: 'Is there a wound that will not close?',          safe: true,  tier: 3, gloss: 'No such wound: they all close.' },
  { q: 'Is there a night that will not end?',            safe: true,  tier: 3, gloss: 'No such night: this one ends.' },
  { q: 'Is there a door you will not, at last, forsake?', safe: true, tier: 3, gloss: 'No such door: it forsakes yours too.' },

  // ───────────── TIER 3 · RUIN ─────────────
  { q: 'Will she never leave me again?',                 safe: false, tier: 3, gloss: 'Two nevers: she leaves you again.' },
  { q: 'Shall my nights never again be as this one?',    safe: false, tier: 3, gloss: 'Two nevers: they shall be as this one.' },
  { q: 'Will the knocking never trouble me again?',      safe: false, tier: 3, gloss: 'Two nevers: it troubles you again.' },
  { q: 'Shall this shadow never reach me?',              safe: false, tier: 3, gloss: 'Two nevers: it reaches you.' },
  { q: 'Will my heart never break again?',               safe: false, tier: 3, gloss: 'Two nevers: it breaks again.' },
  { q: 'Shall I never lose her again?',                  safe: false, tier: 3, gloss: 'Two nevers: you lose her again.' },
  { q: 'Is there any door you will not darken?',         safe: false, tier: 3, gloss: 'No such door: it darkens them all.' },
  { q: 'Is there a night you will not haunt?',           safe: false, tier: 3, gloss: 'No such night: it haunts them all.' },
  { q: 'Is there a sorrow you cannot deepen?',           safe: false, tier: 3, gloss: 'No such sorrow: it deepens them all.' },
  { q: 'Will the night that took her ever give her back?', safe: false, tier: 3, gloss: 'Never given back.' },
  { q: 'Shall the word you speak be any word but that?', safe: false, tier: 3, gloss: 'Never any other word.' },
  { q: 'Is there a hope this bird will not devour?',     safe: false, tier: 3, gloss: 'No such hope: it devours them all.' },
];

/* Neutral: the poem's own question about the bird's name. The Raven's answer is
 * its name, and hearing it costs nothing. Dealt as a safe card. */
export const NAME_QUESTION = {
  q: 'Tell me what thy lordly name is on the Night’s Plutonian shore?',
  safe: true, tier: 1, gloss: 'That is its name. It costs you nothing.',
};

/* The narrator's lines, in Poe's own register. */
export const LINES = {
  open: [
    'Once upon a midnight dreary, while I pondered, weak and weary…',
  ],
  safe: [
    'Then the bird said “Nevermore” — and the lamp burned steadier.',
    'Startled at the stillness broken by reply so aptly spoken…',
    '“Doubtless,” said I, “what it utters is its only stock and store.”',
    'This I sat engaged in guessing — and the flame stood tall once more.',
    '“Other friends have flown before — on the morrow he will leave me.”',
    'And the Raven, still beguiling all my fancy into smiling…',
    'Then, methought, the air grew denser — perfumed from an unseen censer.',
    '“Wretch,” I cried, “thy God hath lent thee respite from thy memories!”',
  ],
  ruin: [
    '“Prophet!” said I, “thing of evil! — prophet still, if bird or devil!”',
    'And the lamp-light o’er him streaming throws his shadow on the floor…',
    '“Be that word our sign of parting, bird or fiend!” I shrieked, upstarting.',
    'Leave no black plume as a token of that lie thy soul hath spoken!',
    'And his eyes have all the seeming of a demon’s that is dreaming…',
    '“Get thee back into the tempest and the Night’s Plutonian shore!”',
    'This and more I sat divining — and the shadow crept a step.',
    '“Take thy beak from out my heart!” — Quoth the Raven, “Nevermore.”',
  ],
  timeout: [
    'The lamp guttered out, and the Raven chose for me. It does not choose kindly.',
    'Too slow — and the bird answered a question I never dared to ask.',
  ],
  hintTier3: 'Mark it well: two nevers make a yes.',
  hintSwap: 'The cards shift — “the silken, sad, uncertain rustling…”',
  hintCroak: 'The bird ruffles its plumes. It will croak early this round.',
  win: 'Take thy beak from out my heart, and take thy form from off my door!',
  lose: 'And my soul from out that shadow that lies floating on the floor / Shall be lifted — nevermore!',
};
