import { expect, test } from 'vitest';
import { decode, encode } from './segments';

test('encode tags each node, escapes markup and keeps word boundaries', () => {
  expect(encode(['Ein Ribosom aus zwei ', 'Unter', 'einheiten', ' ', '<b> & ', '\n'])).toBe(
    '<a i=0>Ein Ribosom aus zwei</a> <a i=1>Unter</a><a i=2>einheiten</a> <a i=4>&lt;b&gt; &amp;</a>',
  );
});

test('decode puts each tag back into its node with the original whitespace', () => {
  const texts = ['Ein Ribosom besteht aus zwei ', 'Untereinheiten', '. Die kleine liest die ', 'Boten-RNA', ' ab.'];
  // a real gtx answer: spaces between tags are moved outside
  const html = '<a i=0>Рибосома состоит из двух</a> <a i=1>субъединиц</a> <a i=2>. Малая считывает</a> <a i=3>мРНК</a> <a i=4>.</a>';
  expect(decode(html, texts)).toEqual(['Рибосома состоит из двух ', 'субъединиц', '. Малая считывает ', 'мРНК', '.']);
});

test('decode: moved tags join the text before them, so the page reads in the translated order', () => {
  const texts = ['I have ', 'never', ' seen ', 'such a big', ' house.'];
  const html = 'Oh <a i=0>Ich habe</a> <a i=1>noch nie</a> <a i=3>ein so großes</a> Haus <a i=2>gesehen</a> <a i=4>&#39;&lt;.&gt;&amp;</a>';
  const out = decode(html, texts);
  expect(out).toEqual(['Oh Ich habe ', 'noch nie ', '', 'ein so großes Haus gesehen', " '<.>&"]);
  expect(out.join('')).toBe("Oh Ich habe noch nie ein so großes Haus gesehen '<.>&");
});

test('decode: duplicate and unknown tags, brackets', () => {
  const texts = ['A ', '(', ' b)', ' c'];
  const html = '<a i=0>А</a> <a i=9>!</a> <a i=1>(</a> <a i=2>б)</a> <a i=2>в</a>';
  expect(decode(html, texts)).toEqual(['А! ', '(', 'б) в', '']);
});

test('decode: no space before a period or after a bracket, even where the page had one', () => {
  const texts = ['Kette', ' eines ', 'Proteins', ' übersetzt. Dann', ' (', 'lat.', ' für ', 'Wort', ')'];
  const html = '<a i=0>цепи</a> <a i=1>белка</a> <a i=3>. Затем</a> <a i=4>(</a> <a i=5>лат.</a> <a i=6>«</a> <a i=7>слово</a> <a i=8>»)</a>';
  const out = decode(html, texts);
  expect(out).toEqual(['цепи', ' белка', '', '. Затем', ' (', 'лат.', ' «', 'слово', '»)']);
  expect(out.join('')).toBe('цепи белка. Затем (лат. «слово»)');
});

test("decode: no space Google adds between nodes the page wrote together", () => {
  expect(decode('<a i=0>существах.</a> <a i=1>[</a> <a i=2>1</a> <a i=3>]</a>', ['Lebewesen.', '[', '1', ']']).join('')).toBe('существах.[1]');
});

test('decode keeps a space on the side of the link the page had it, not inside the link', () => {
  expect(decode('<a i=0>en:Ein</a> <a i=1>en:Ribosom</a> <a i=2>en:ist alt.</a>', ['Ein ', 'Ribosom', ' ist alt.'])).toEqual([
    'en:Ein ',
    'en:Ribosom',
    ' en:ist alt.',
  ]);
});

test("decode: Google's space where the page had none between the moved words", () => {
  const texts = ['der ', 'DNA', '-Doppelstrang', ' umgeschrieben'];
  const html = '<a i=0>двухцепочечной</a> <a i=1>ДНК,</a> <a i=3>переписана</a>';
  expect(decode(html, texts).join('')).toBe('двухцепочечной ДНК, переписана');
});

test('line breaks of a pre-wrap block travel as <br> and come back', () => {
  const texts = ['Hallo Freunde,\nich komme.\n\nBis bald!\n'];
  expect(encode(texts, true)).toBe('<a i=0>Hallo Freunde,<br>ich komme.<br><br>Bis bald!</a>');
  expect(decode('<a i=0>Привет, друзья,<br> я приду.<br><br> Пока!</a>', texts)).toEqual(['Привет, друзья,\nя приду.\n\nПока!\n']);
});

test('decode: no tags at all goes to the first node, blank nodes stay as they are', () => {
  expect(decode('Привет, мир', ['\n', 'Hello, ', ' ', 'world'])).toEqual(['\n', 'Привет, мир ', ' ', '']);
});
