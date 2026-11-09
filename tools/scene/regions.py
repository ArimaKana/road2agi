"""What each region's kit is made of. A module is a list of solids: (shape, centre, size, turn in degrees, atlas, cell in the 4x4 atlas).
The cells are read off art-source/scenes/tex-<region>-<part>.png. Tags: solid blocks walking, fade goes see-through when it hides the hero, split parts move at runtime.
"""
TILE, WALL_HEIGHT = 1.5, 1.2


def box(c, s, atlas, cell, turn=(0, 0, 0)):
    return ('box', c, s, turn, atlas, cell)


def cyl(c, s, atlas, cell, turn=(0, 0, 0)):
    return ('cyl', c, s, turn, atlas, cell)


def cone(c, s, atlas, cell, turn=(0, 0, 0)):
    return ('cone', c, s, turn, atlas, cell)


def ball(c, s, atlas, cell, turn=(0, 0, 0)):
    return ('ball', c, s, turn, atlas, cell)


def floors(cells):
    return {f'floor_{i}': ([box((0, 0, -.03), (TILE, TILE, .06), 'floor', c)], ('walk',)) for i, c in enumerate(cells)}


def walls(cells, cap, extras=None):
    """One tile of wall each. extras: {index: solids} added to that piece."""
    out = {}
    for i, c in enumerate(cells):
        parts = [box((0, 0, WALL_HEIGHT / 2 - .04), (TILE, TILE, WALL_HEIGHT - .08), 'wall', c), box((0, 0, WALL_HEIGHT - .04), (TILE + .04, TILE + .04, .08), 'wall', cap)]
        out[f'wall_{i}'] = (parts + (extras or {}).get(i, []), ('solid', 'fade'))
    return out


def door(name, post, leaf, cap, wide=TILE):
    """One tile of a door's run: the frame stays, the leaf drops into the floor when it opens."""
    return {
        f'{name}_frame': ([box((0, 0, -.02), (wide, TILE, .04), 'wall', cap), box((-wide / 2 + .1, 0, .75), (.2, TILE, 1.5), 'wall', post), box((wide / 2 - .1, 0, .75), (.2, TILE, 1.5), 'wall', post), box((0, 0, 1.5), (wide, TILE, .16), 'wall', cap)], ('fade',)),
        f'{name}_leaf': ([box((0, 0, .6), (wide - .2, .22, 1.2), 'wall', leaf)], ('solid', 'split')),
    }


def crate(cell, edge, size=1.3, tall=1.0):
    parts = [box((0, 0, tall / 2), (size, size, tall), 'prop', cell)]
    for x in (-1, 1):
        for y in (-1, 1):
            parts.append(box((x * (size / 2 - .04), y * (size / 2 - .04), tall / 2), (.1, .1, tall + .02), 'prop', edge))
    return parts


def lamp(pole, glass, tall=1.8):
    return [cyl((0, 0, tall / 2), (.12, .12, tall), 'prop', pole), box((0, 0, tall + .14), (.3, .3, .32), 'prop', glass), box((0, 0, tall + .34), (.4, .4, .06), 'prop', pole), cyl((0, 0, .05), (.44, .44, .1), 'prop', pole)]


def pipe(metal, flange, length=1.5):
    return [cyl((0, 0, .32), (.4, .4, length), 'prop', metal, (90, 0, 0)), cyl((0, -length / 2 + .08, .32), (.54, .54, .1), 'prop', flange, (90, 0, 0)), cyl((0, length / 2 - .08, .32), (.54, .54, .1), 'prop', flange, (90, 0, 0)), box((0, 0, .06), (.5, .3, .12), 'prop', flange)]


def press(frame, plate):
    """The frame is set in the floor; the plate is a separate piece that slams down from above at runtime."""
    return {
        'trap_press': ([box((0, 0, .01), (TILE, TILE, .05), 'floor', frame)], ('walk',)),
        'trap_press_plate': ([box((0, 0, .1), (TILE - .06, TILE - .06, .2), 'prop', plate), box((0, 0, .3), (TILE * .4, TILE * .4, .2), 'prop', plate)], ('split',)),
    }


def port():
    W, P = 'wall', 'prop'
    m = {}
    m.update(floors([0, 1, 2, 7, 6, 11, 3, 5]))
    m.update(walls([0, 1, 2, 6, 7, 10, 5, 4], 15, {7: [cyl((.55, 0, .6), (.2, .2, 1.1), P, 3), cyl((.1, 0, .6), (.2, .2, 1.1), P, 12)]}))
    for name, leaf in (('door_in', 14), ('door_out', 5), ('door_boss', 11), ('door_shop', 2)):
        m.update(door(name, 15, leaf, 3))
    m['door_frame'] = m['door_in_frame']
    m['pipe_throttle'] = (pipe(3, 2, 2.6) + [box((0, 0, .68), (.55, .5, .4), P, 5), cyl((0, 0, .98), (.5, .5, .08), P, 2)], ('solid', 'interact'))
    m['supply_counter'] = ([box((0, 0, .45), (2.4, .9, .9), P, 9), box((0, 0, .93), (2.5, 1, .06), P, 10), box((-.7, 0, 1.1), (.4, .4, .3), P, 0)], ('solid', 'interact'))
    m['upgrade_bench'] = ([box((0, 0, .42), (1.5, .9, .84), P, 10), box((0, 0, .88), (1.6, 1, .08), P, 2), box((.4, 0, 1.05), (.3, .4, .26), P, 6), cyl((-.4, 0, 1.0), (.3, .3, .2), P, 3)], ('solid', 'interact'))
    m['crate_open'] = ([box((0, 0, .42), (1.2, 1.2, .84), P, 0), box((0, -.56, 1.08), (1.2, .08, .6), P, 9, (-30, 0, 0)), box((0, 0, .78), (.9, .9, .1), P, 6)], ('solid', 'interact'))
    m['lever'] = ([box((0, 0, .3), (.6, .6, .6), P, 10), box((0, .1, .86), (.1, .1, .8), P, 5, (28, 0, 0)), ball((0, .28, 1.2), (.2, .2, .2), P, 14)], ('solid', 'interact'))
    m['data_pad'] = ([cyl((0, 0, .06), (1.8, 1.8, .12), P, 4), cyl((0, 0, .13), (1.4, 1.4, .03), P, 6)], ('walk', 'interact'))
    m['crates_stack'] = (crate(0, 1) + [box((.05, .05, 1.34), (.8, .8, .68), P, 9)], ('solid', 'fade', 'cover'))
    m['cover_crate'] = (crate(0, 1), ('solid', 'cover'))
    m['barrel'] = ([cyl((0, 0, .5), (.8, .8, 1), P, 11), cyl((0, 0, .25), (.84, .84, .07), P, 2), cyl((0, 0, .75), (.84, .84, .07), P, 2)], ('solid',))
    m['pipe_run'] = (pipe(12, 2), ('solid',))
    m['lamp_post'] = (lamp(10, 15), ('solid',))
    m['rope_coil'] = ([cyl((0, 0, .1), (.9, .9, .2), P, 7), cyl((0, 0, .26), (.66, .66, .14), P, 7)], ('walk',))
    m['bollard'] = ([cyl((0, 0, .36), (.5, .5, .72), P, 4), cyl((0, 0, .72), (.66, .66, .12), P, 4)], ('solid',))
    m['trap_belt'] = ([box((0, 0, .02), (TILE, TILE, .05), P, 13)] + [cyl((x, 0, .01), (.14, .14, TILE), P, 3, (90, 0, 0)) for x in (-.65, .65)], ('walk', 'split'))
    m.update(press(5, 14))
    m['trap_valve'] = ([box((0, 0, .32), (TILE - .2, TILE - .2, .64), P, 2), cyl((0, -.52, .5), (.56, .56, .46), P, 5, (90, 0, 0)), cyl((0, 0, .85), (.6, .6, .1), P, 14), box((0, 0, 1.0), (.12, .12, .3), P, 3)], ('solid', 'interact'))
    return m


def library():
    P = 'prop'
    m = {}
    m.update(floors([0, 1, 2, 3, 5, 9, 12, 11]))
    m.update(walls([0, 1, 2, 3, 4, 6, 8, 7], 15, {2: [box((0, -.68, .6), (TILE - .1, .16, 1.1), P, 1)], 5: [box((0, -.68, .6), (TILE - .1, .16, 1.1), P, 9)]}))
    for name, leaf in (('door_in', 8), ('door_out', 4), ('door_boss', 12), ('door_shop', 0)):
        m.update(door(name, 3, leaf, 15))
    m['door_frame'] = m['door_in_frame']
    m['stele_erased'] = ([box((0, 0, .2), (1.6, .9, .4), P, 2), box((0, 0, 1.2), (1.1, .4, 1.8), P, 6), box((0, -.21, 1.2), (.9, .02, 1.5), P, 12), box((0, 0, 2.15), (1.2, .5, .12), P, 2)], ('solid', 'interact'))
    m['lectern'] = ([cyl((0, 0, .5), (.3, .3, 1), P, 0), box((0, 0, 1.08), (.8, .6, .08), P, 8, (-24, 0, 0)), box((0, 0, 1.14), (.7, .5, .05), P, 5, (-24, 0, 0)), cyl((0, 0, .04), (.7, .7, .08), P, 10)], ('solid', 'interact'))
    m['index_cabinet'] = ([box((0, 0, .85), (1.3, .7, 1.7), P, 0), box((0, -.36, .85), (1.15, .03, 1.5), P, 1), box((0, 0, 1.74), (1.4, .8, .08), P, 10)], ('solid', 'fade', 'interact'))
    m['mirror_stand'] = ([box((0, 0, 1.1), (1, .1, 1.8), P, 2), box((0, -.06, 1.1), (.86, .02, 1.66), P, 4), cyl((0, 0, .08), (.9, .9, .16), P, 10)], ('solid', 'fade', 'interact'))
    m['supply_counter'] = ([box((0, 0, .45), (2.4, .9, .9), P, 8), box((0, 0, .93), (2.5, 1, .06), P, 2), box((.7, 0, 1.1), (.5, .3, .28), P, 9)], ('solid', 'interact'))
    m['data_pad'] = ([cyl((0, 0, .05), (1.8, 1.8, .1), P, 7), cyl((0, 0, .11), (1.4, 1.4, .03), P, 6)], ('walk', 'interact'))
    m['cover_crate'] = ([box((0, 0, .5), (1.3, 1.3, 1), P, 1), box((0, 0, 1.02), (1.36, 1.36, .05), P, 8)], ('solid', 'cover'))
    m['book_pile'] = ([box((0, 0, .1), (.8, .6, .2), P, 9), box((.05, 0, .28), (.7, .5, .16), P, 1, (0, 0, 10)), box((0, .03, .44), (.56, .42, .14), P, 9, (0, 0, -8))], ('walk',))
    m['lamp_post'] = (lamp(10, 3), ('solid',))
    m['ladder'] = ([box((-.35, 0, 1.2), (.08, .08, 2.4), P, 0, (10, 0, 0)), box((.35, 0, 1.2), (.08, .08, 2.4), P, 0, (10, 0, 0))] + [box((0, .2 - k * .05, .35 + k * .4), (.7, .06, .05), P, 8) for k in range(5)], ('solid', 'fade'))
    m['low_shelf'] = ([box((0, 0, .5), (1.4, .5, 1), P, 8), box((0, -.26, .5), (1.26, .02, .84), P, 9)], ('solid',))
    m['broken_mirror'] = ([box((0, 0, .75), (.9, .08, 1.3), P, 12, (0, 8, 0)), box((.55, -.2, .12), (.4, .24, .03), P, 4, (0, 0, 20)), box((-.5, -.3, .08), (.3, .2, .03), P, 12, (0, 0, -30))], ('solid',))
    m['scroll_rack'] = ([box((0, 0, .6), (1, .4, 1.2), P, 0)] + [cyl((-.3 + k * .3, -.1, .3 + j * .3), (.14, .14, .5), P, 5, (90, 0, 0)) for k in range(3) for j in range(3)], ('solid',))
    m['trap_mirror'] = ([cyl((0, 0, .1), (1.1, 1.1, .2), P, 10), box((0, 0, 1), (1.3, .12, 1.7), P, 2), box((0, -.08, 1), (1.14, .02, 1.5), P, 4)], ('solid', 'split', 'interact'))
    m['trap_shelf'] = ([box((0, 0, .85), (TILE, .9, 1.7), P, 0), box((0, -.46, .85), (TILE - .12, .02, 1.5), P, 1), box((0, .46, .85), (TILE - .12, .02, 1.5), P, 9), box((0, 0, 1.72), (TILE + .06, 1, .06), P, 10)], ('solid', 'fade', 'split'))
    return m


def forge():
    P = 'prop'
    m = {}
    m.update(floors([0, 1, 2, 4, 5, 6, 7, 3]))
    m.update(walls([0, 1, 3, 4, 7, 10, 2, 11], 12))
    for name, leaf in (('door_in', 15), ('door_out', 8), ('door_boss', 5), ('door_shop', 10)):
        m.update(door(name, 5, leaf, 12))
    m['door_frame'] = m['door_in_frame']
    m['codex_table'] = ([box((0, 0, .45), (1.8, 1, .9), P, 1), box((0, 0, .95), (1.2, .9, .1), P, 14, (-10, 0, 0)), box((0, 0, 1.03), (1, .7, .04), P, 12, (-10, 0, 0)), box((-.8, 0, 1.2), (.1, .1, .6), P, 8), box((.8, 0, 1.2), (.1, .1, .6), P, 8)], ('solid', 'interact'))
    m['quench_tank'] = ([box((0, 0, .4), (1.8, 1, .8), P, 1), box((0, 0, .8), (1.6, .8, .03), P, 14), box((0, 0, .85), (1.9, 1.1, .08), P, 2)], ('solid', 'interact'))
    m['anvil'] = ([box((0, 0, .25), (.7, .7, .5), P, 0), box((0, 0, .6), (.4, .4, .3), P, 2), box((0, 0, .84), (1.2, .46, .2), P, 2), cone((-.8, 0, .84), (.34, .34, .46), P, 2, (0, -90, 0))], ('solid', 'interact'))
    m['supply_counter'] = ([box((0, 0, .45), (2.4, .9, .9), P, 7), box((0, 0, .93), (2.5, 1, .06), P, 0), box((.7, 0, 1.1), (.5, .4, .28), P, 3)], ('solid', 'interact'))
    m['lever'] = ([box((0, 0, .3), (.6, .6, .6), P, 1), box((0, .1, .86), (.1, .1, .8), P, 2, (28, 0, 0)), ball((0, .28, 1.2), (.2, .2, .2), P, 10)], ('solid', 'interact'))
    m['data_pad'] = ([cyl((0, 0, .06), (1.8, 1.8, .12), P, 0), cyl((0, 0, .13), (1.4, 1.4, .03), P, 4)], ('walk', 'interact'))
    m['cover_crate'] = ([box((0, 0, .5), (1.3, 1.3, 1), P, 1), box((0, 0, 1.02), (1.36, 1.36, .05), P, 2)], ('solid', 'cover'))
    m['coal_heap'] = ([ball((0, 0, .2), (1.3, 1.1, .6), P, 5), ball((.25, .1, .38), (.6, .5, .4), P, 4)], ('walk',))
    m['chain_hang'] = ([box((0, 0, 2.5), (.8, .8, .2), P, 1), box((0, 0, 1.4), (.14, .14, 2.2), P, 9)], ('fade',))
    m['ingot_stack'] = ([box((0, 0, .1), (1, .5, .2), P, 10), box((.05, 0, .3), (.9, .46, .2), P, 11), box((0, 0, .5), (.8, .42, .2), P, 10)], ('solid',))
    m['gear_stand'] = ([cyl((0, 0, .8), (1.2, 1.2, .2), P, 2, (90, 0, 0)), box((0, 0, .4), (.4, .3, .8), P, 1)], ('solid',))
    m['pipe_elbow'] = (pipe(11, 2) + [cyl((0, .68, .7), (.4, .4, .8), P, 11)], ('solid',))
    m['brazier'] = ([cone((0, 0, .5), (.4, .4, 1), P, 0, (180, 0, 0)), cyl((0, 0, 1.03), (.9, .9, .1), P, 2), ball((0, 0, 1.12), (.7, .7, .3), P, 4)], ('solid',))
    m['trap_vent'] = ([box((0, 0, .02), (TILE, TILE, .05), 'floor', 9), cyl((0, 0, .07), (1.1, 1.1, .06), P, 2), cyl((0, 0, .09), (.8, .8, .03), P, 4)], ('walk', 'split'))
    m['trap_stamper'] = ([box((-.68, 0, 1.4), (.14, .4, 2.8), P, 1), box((.68, 0, 1.4), (.14, .4, 2.8), P, 1), box((0, 0, 2.7), (1.5, .5, .2), P, 2)], ('fade', 'split'))
    m['trap_stamper_head'] = ([box((0, 0, .28), (TILE - .24, TILE - .24, .56), P, 1), box((0, 0, .7), (.5, .5, .4), P, 2)], ('split',))
    return m


def zero():
    P = 'prop'
    m = {}
    m.update(floors([0, 1, 2, 5]))
    m.update(walls([1, 9, 3, 11], 0))
    m.update(door('door_in', 1, 6, 0))
    m['door_frame'] = m['door_in_frame']
    m['archive_monolith'] = ([box((0, 0, 1.3), (1, .5, 2.6), P, 13), box((0, -.26, 1.3), (.8, .02, 2.3), P, 4)], ('solid', 'interact'))
    m['node_pedestal'] = ([box((0, 0, .15), (1.6, 1.6, .3), P, 13), box((0, 0, .45), (1.1, 1.1, .3), P, 5), box((0, 0, .75), (.6, .6, .3), P, 0)], ('solid', 'interact'))
    m['data_pad'] = ([box((0, 0, .05), (1.8, 1.8, .1), P, 0), box((0, 0, .11), (1.4, 1.4, .03), P, 11)], ('walk', 'interact'))
    m['cover_crate'] = ([box((0, 0, .5), (1.3, 1.3, 1), P, 13), box((0, 0, 1.02), (1.36, 1.36, .05), P, 5)], ('solid', 'cover'))
    m['cube_float'] = ([box((0, 0, 1.3), (.7, .7, .7), P, 5, (35, 20, 45)), box((0, 0, .06), (.8, .8, .12), P, 0)], ('solid',))
    m['shard'] = ([cone((0, 0, .8), (.8, .8, 1.6), P, 1), cone((.5, .3, .45), (.4, .4, .9), P, 7, (0, 12, 30))], ('solid',))
    m['slab_arc'] = ([box((-.8, 0, 1), (.3, .3, 2), P, 13), box((.8, 0, 1), (.3, .3, 2), P, 5), box((0, 0, 2.15), (1.9, .3, .3), P, 13)], ('solid', 'fade'))
    m['plinth'] = ([box((0, 0, .3), (1, 1, .6), P, 5), box((0, 0, .64), (.8, .8, .08), P, 13)], ('solid',))
    m['trap_scan'] = ([box((0, 0, .04), (TILE, .22, .08), P, 11)], ('split',))
    m['trap_erase'] = ([box((0, 0, -.03), (TILE, TILE, .06), 'floor', 15)], ('walk', 'split'))
    m['trap_beacon'] = ([box((0, 0, .08), (1, 1, .16), P, 0), box((0, 0, .9), (.34, .34, 1.5), P, 5), box((0, 0, 1.76), (.5, .5, .22), P, 11)], ('solid', 'interact'))
    return m


# The Tide Node is not in level.ts, so its one room is written here. W weapon rack, A card album, B bench for talking, L lamp, P pool, C floating card.

REGIONS = {
    'port': dict(modules=port, sky=(.02, .05, .06), floor_modules=['floor_0'] * 6 + ['floor_1'] * 5 + ['floor_3', 'floor_4', 'floor_5'], wall_modules=['wall_0', 'wall_1', 'wall_2', 'wall_3', 'wall_4', 'wall_5', 'wall_6'], cover='cover_crate', trap_modules=dict(press='trap_press', belt='trap_belt', valve='trap_valve', pad='data_pad')),
    'library': dict(modules=library, sky=(.03, .025, .06), floor_modules=['floor_0'] * 6 + ['floor_1'] * 4 + ['floor_2', 'floor_3'], wall_modules=['wall_0', 'wall_1', 'wall_2', 'wall_3', 'wall_4', 'wall_5', 'wall_6'], cover='cover_crate', trap_modules=dict(mirror='trap_mirror', shelf='trap_shelf', pad='data_pad')),
    'forge': dict(modules=forge, sky=(.04, .025, .02), floor_modules=['floor_0'] * 6 + ['floor_3'] * 3 + ['floor_1', 'floor_2', 'floor_6'], wall_modules=['wall_0', 'wall_1', 'wall_2', 'wall_3', 'wall_4', 'wall_5', 'wall_6', 'wall_7'], cover='cover_crate', trap_modules=dict(vent='trap_vent', stamper='trap_stamper', pad='data_pad')),
    'zero': dict(modules=zero, sky=(.01, .01, .015), floor_modules=['floor_0'] * 8 + ['floor_1', 'floor_2', 'floor_3'], wall_modules=['wall_0', 'wall_1', 'wall_2', 'wall_3'], cover='cover_crate', trap_modules=dict(scan='trap_scan', erase='trap_erase', beacon='trap_beacon', pad='data_pad')),
}
