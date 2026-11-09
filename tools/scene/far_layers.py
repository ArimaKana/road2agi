"""Export the far background of each region for the game: python tools/scene/far_layers.py"""
from PIL import Image

for region in ('port', 'library', 'forge', 'zero'):
    image = Image.open(f'art-source/scenes/far-{region}.png').convert('RGB')
    image.resize((1280, round(1280 * image.height / image.width)), Image.LANCZOS).save(f'game/public/assets/scenes/{region}/far.webp', quality=78, method=6)
