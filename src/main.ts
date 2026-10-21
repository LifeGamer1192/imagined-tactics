import { loadFaces } from './art/faces';
import { App } from './ui/app';
import { initHelp } from './ui/help';

// 史実の人物の顔絵の台帳（hist-sim と共有）。取れなければ顔は出さない
void loadFaces(import.meta.env.BASE_URL ?? './');

new App(document.getElementById('app')!);
initHelp();
