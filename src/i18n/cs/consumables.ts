/** Texty spotřebek — skládá pranostiky, babské rady a úřední razítka (klíče `consumables.<id>.name|desc|flavor`). */
import { pranostiky } from './pranostiky';
import { rady } from './rady';
import { razitka } from './razitka';

export const consumables = { ...pranostiky, ...rady, ...razitka };
