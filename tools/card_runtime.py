"""Compress the finished summon cards for the game: python tools/card_runtime.py

Reads art-source/cards/final/ and writes game/public/assets/cards/<id>.webp, the card face with its signature, and <id>-figure.webp,
the figure that slides in on a summon, standing on the bottom edge of the screen. Item cards are only a face.
"""
import os
from PIL import Image


FINAL = 'art-source/cards/final'
OUT = 'game/public/assets/cards'
CARDS = ('kimi', 'glm', 'qwen', 'seed', 'minimax', 'gpt', 'claude', 'grok', 'gemini')
ITEMS = ('heal', 'refill', 'cap')
FACE, FIGURE = (384, 576), (683, 1024)


def main():
    os.makedirs(OUT, exist_ok=True)
    for card in CARDS + ITEMS:
        Image.open(f'{FINAL}/{card}.png').convert('RGB').resize(FACE, Image.LANCZOS).save(f'{OUT}/{card}.webp', quality=86, method=6)
    for card in CARDS:
        Image.open(f'{FINAL}/{card}-figure.png').convert('RGBA').resize(FIGURE, Image.LANCZOS).save(f'{OUT}/{card}-figure.webp', quality=86, method=6)


if __name__ == '__main__':
    main()
