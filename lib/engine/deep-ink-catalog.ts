import type { AgeBand } from '../types';
import base57 from '../content/ink/deep/w1d1-5-7.json';
import base810 from '../content/ink/deep/w1d1-8-10.json';
import base1113 from '../content/ink/deep/w1d1-11-13.json';
import music57 from '../content/ink/deep/w1d1_music-5-7.json';
import music810 from '../content/ink/deep/w1d1_music-8-10.json';
import music1113 from '../content/ink/deep/w1d1_music-11-13.json';
import picture57 from '../content/ink/deep/w1d1_picture-5-7.json';
import picture810 from '../content/ink/deep/w1d1_picture-8-10.json';
import picture1113 from '../content/ink/deep/w1d1_picture-11-13.json';

import day257 from '../content/ink/deep/w1d2-5-7.json';
import day2810 from '../content/ink/deep/w1d2-8-10.json';
import day21113 from '../content/ink/deep/w1d2-11-13.json';
import postcard57 from '../content/ink/deep/w1d2_postcard-5-7.json';
import postcard810 from '../content/ink/deep/w1d2_postcard-8-10.json';
import postcard1113 from '../content/ink/deep/w1d2_postcard-11-13.json';

import extra0_0 from '../content/ink/deep/w1d3-5-7.json';
import extra0_1 from '../content/ink/deep/w1d3-8-10.json';
import extra0_2 from '../content/ink/deep/w1d3-11-13.json';
import extra1_0 from '../content/ink/deep/w1d3_garden-5-7.json';
import extra1_1 from '../content/ink/deep/w1d3_garden-8-10.json';
import extra1_2 from '../content/ink/deep/w1d3_garden-11-13.json';
import extra2_0 from '../content/ink/deep/w1d4-5-7.json';
import extra2_1 from '../content/ink/deep/w1d4-8-10.json';
import extra2_2 from '../content/ink/deep/w1d4-11-13.json';
import extra3_0 from '../content/ink/deep/w1d4_bridge-5-7.json';
import extra3_1 from '../content/ink/deep/w1d4_bridge-8-10.json';
import extra3_2 from '../content/ink/deep/w1d4_bridge-11-13.json';

import fifth0_0 from '../content/ink/deep/w1d5-5-7.json';
import fifth0_1 from '../content/ink/deep/w1d5-8-10.json';
import fifth0_2 from '../content/ink/deep/w1d5-11-13.json';
import fifth1_0 from '../content/ink/deep/w1d5_puppet-5-7.json';
import fifth1_1 from '../content/ink/deep/w1d5_puppet-8-10.json';
import fifth1_2 from '../content/ink/deep/w1d5_puppet-11-13.json';

/** Static programs are copied into the session, not reloaded when the catalog changes. */
const programs: Readonly<Record<string, Record<AgeBand, string>>> = {
 w1d1: {'5-7':JSON.stringify(base57),'8-10':JSON.stringify(base810),'11-13':JSON.stringify(base1113)},
 w1d1_music: {'5-7':JSON.stringify(music57),'8-10':JSON.stringify(music810),'11-13':JSON.stringify(music1113)},
 w1d1_picture: {'5-7':JSON.stringify(picture57),'8-10':JSON.stringify(picture810),'11-13':JSON.stringify(picture1113)},
 w1d2: {'5-7':JSON.stringify(day257),'8-10':JSON.stringify(day2810),'11-13':JSON.stringify(day21113)},
 w1d2_postcard: {'5-7':JSON.stringify(postcard57),'8-10':JSON.stringify(postcard810),'11-13':JSON.stringify(postcard1113)},
 w1d3: {'5-7':JSON.stringify(extra0_0),'8-10':JSON.stringify(extra0_1),'11-13':JSON.stringify(extra0_2)},
 w1d3_garden: {'5-7':JSON.stringify(extra1_0),'8-10':JSON.stringify(extra1_1),'11-13':JSON.stringify(extra1_2)},
 w1d4: {'5-7':JSON.stringify(extra2_0),'8-10':JSON.stringify(extra2_1),'11-13':JSON.stringify(extra2_2)},
 w1d4_bridge: {'5-7':JSON.stringify(extra3_0),'8-10':JSON.stringify(extra3_1),'11-13':JSON.stringify(extra3_2)},
 w1d5: {'5-7':JSON.stringify(fifth0_0),'8-10':JSON.stringify(fifth0_1),'11-13':JSON.stringify(fifth0_2)},
 w1d5_puppet: {'5-7':JSON.stringify(fifth1_0),'8-10':JSON.stringify(fifth1_1),'11-13':JSON.stringify(fifth1_2)},
};
export function deepInkFor(id:string, band:AgeBand):string|undefined {
 return Object.hasOwn(programs,id) ? programs[id][band] : undefined;
}
