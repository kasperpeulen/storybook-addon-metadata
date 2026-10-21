/** Story files for the parser tests, keyed by what they are about. */
const storyFiles = {
  inlineStory: `
    import { Button } from './Button';
    export default {
      title: 'Example/Button',
      component: Button,
      args: { primary: false, size: 'medium' },
    };
    export const Primary = { args: { primary: true, label: 'Button', count: 2, empty: null } };
  `,
  namedExport: `
    import { Button } from './Button';
    export default { title: 'Example/Button', component: Button };
    const Secondary = { args: { label: 'Secondary' } };
    export { Secondary };
  `,
  renamedExport: `
    import { Button } from './Button';
    export default { title: 'Example/Button', component: Button };
    const Base = { args: { label: 'Base' } };
    export { Base as Renamed };
  `,
  aliasedStory: `
    import { Button } from './Button';
    export default { title: 'Example/Button', component: Button };
    export const Primary = { args: { label: 'Primary' } };
    export const Copy = Primary;
    export { Primary as Again };
  `,
  functions: `
    import { fn } from 'storybook/test';
    import { Button } from './Button';
    export default { title: 'Example/Button', component: Button, args: { onClick: fn() } };
    const Arrow = { args: { onHover: () => 1 } };
    export { Arrow };
  `,
  nestedObject: `
    import { Button } from './Button';
    export default { title: 'Example/Button', component: Button };
    const Nested = { args: { style: { color: 'red', size: 2 } } };
    export { Nested };
  `,
  aliasedComponent: `
    import { Button as Btn, type ButtonProps } from './Button';
    export default { title: 'Example/Button', component: Btn };
  `,
};

export { storyFiles };
