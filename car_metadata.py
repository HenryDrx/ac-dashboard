"""Validate metadata read from the current car; never look up a car catalogue."""
import math


def resolve_gears(actual=None):
    if (type(actual) in (int, float) and math.isfinite(actual)
            and 1 <= actual <= 20 and actual == int(actual)):
        return int(actual), 'CSP car physics'
    return None, 'unavailable'


def resolve_race_position(shared_position, bridge):
    """Use CSP's current ranking; missing CSP rank cannot fall back to a grid reading."""
    connected=bridge.get('csp_connected',False)
    value=bridge.get('race_position') if connected else shared_position
    if (type(value) in (int,float) and math.isfinite(value)
            and 0<value<=10000 and value==int(value)):
        return int(value),'CSP live ranking' if connected else 'AC shared memory'
    return None,'unavailable'
