/**
 * @jest-environment node
 */

import {it, expect, jest, afterEach} from '@jest/globals'
import {SiteStore} from './sitestore.js'

class chromeMockStorage {
    constructor() {
    }
    get(lst, cb) {
        cb({});
    }
}

afterEach(() => {
});

it('sitestorage.get should return array of sites from old format', async () => {
    let storage = new chromeMockStorage();

    jest.spyOn(storage, 'get').mockImplementation((lst, cb)=>{
        console.log("storage.sync.get(",lst);
        if (lst.includes('sites'))
            cb({
            "sites": {
            "url1.com": { "urla.no": { "generation": 1, "type": "l", "username": "" } },
            "url2.co.uk": { "urlb.com": { "generation": 1, "type": "l", "username": "" } },
            "url2.de": { "urlb.com": { "generation": 1, "type": "l", "username": "" } } }
            });
        else
            cb({});
    });

    let sitestore = new SiteStore(storage);

    let a = await sitestore.get("");
    expect(storage.get).toHaveBeenCalledWith(
        expect.arrayContaining(['sites', 'sitedata']),
        expect.anything());
    expect(a).toEqual(expect.arrayContaining([
        {"sitename": "urla.no", "url": ["url1.com"], "generation": 1, "type": "l", "username": ""},
        {"sitename": "urlb.com", "url": ["url2.co.uk"], "generation": 1, "type": "l", "username": ""},
        {"sitename": "urlb.com", "url": ["url2.de"], "generation": 1, "type": "l", "username": ""}
    ]));
});

