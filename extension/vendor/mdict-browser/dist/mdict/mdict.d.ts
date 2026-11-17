import { MDictParser } from "./mdict-parser";
export declare type WordList = Promise<Array<{
    word: string;
    offset: number;
}>>;
export declare class Mdict extends MDictParser {
    cached_keys: any;
    mutual_ticket: number;
    trail: any;
    constructor(file: File);
    static build(file: File): Promise<Mdict>;
    private reduce;
    private shrink;
    private loadKeys;
    private seekVanguard;
    private appendMore;
    private followUp;
    private matchKeys;
    private matchOffset;
    private readDefinition;
    private redirects;
    private read_object;
    private findResource;
    private mdx;
    private mdd;
    getWordList(query: any, offset?: any): WordList;
    getDefinition(offset: any): Promise<string>;
}
export default Mdict;
