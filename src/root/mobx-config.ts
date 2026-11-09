import { configure } from 'mobx';

// Observed state may change only inside actions (MobX warns otherwise). Imported once, first, by the
// root layout and by the Jest setup.
configure({ enforceActions: 'observed' });
