// Minimal observable store holding the live World plus UI-relevant state.
// Panels subscribe to named events; the sim loop publishes them.

import { createWorld } from './world.js';
import { GOALS, DEFAULT_PROGRAM } from './definitions.js';

export const EVENTS = {
  FACTORY_BUILT: 'factory:built',
  RUN_ERROR: 'run:error',
  TICK: 'sim:tick',
  SELECT: 'select',
  GOAL_COMPLETE: 'goal:complete',
  RESET: 'reset',
};

export function createStore() {
  const listeners = new Map();
  const goals = GOALS.map((g) => ({ ...g, complete: false }));

  const store = {
    world: createWorld(),
    program: DEFAULT_PROGRAM,
    errors: [],
    goals,
    selected: null, // { kind:'machine'|'stockpile', key }
    running: false,

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },

    emit(event, payload) {
      const set = listeners.get(event);
      if (set) for (const fn of set) fn(payload);
    },

    setWorld(world) {
      store.world = world;
      store.running = world.machines.length > 0;
      store.errors = [];
      store.emit(EVENTS.FACTORY_BUILT, world);
    },

    setErrors(errors) {
      store.errors = errors;
      store.emit(EVENTS.RUN_ERROR, errors);
    },

    reset() {
      store.world = createWorld();
      store.running = false;
      store.selected = null;
      for (const g of store.goals) g.complete = false;
      store.emit(EVENTS.RESET);
      store.emit(EVENTS.FACTORY_BUILT, store.world);
    },

    select(sel) {
      store.selected = sel;
      store.emit(EVENTS.SELECT, sel);
    },
  };

  return store;
}
