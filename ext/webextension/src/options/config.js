/* Copyright Torbjorn Tyridal 2015-2021

    This file is part of Masterpassword for Firefox (herby known as "the software").

    The software is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    The software is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with the software.  If not, see <http://www.gnu.org/licenses/>.
*/
/*jshint browser:true, devel:true, nonstandard:true, -W055 */
/* globals chrome */

"use strict";
import sitestore from "../lib/sitestore.js";
import mpw_utils from "../lib/mpw-utils.js";

(function(){
function encode_utf8(s) {
  return unescape(encodeURIComponent(s));
}
function string_is_plain_ascii(s) {
    return s.length === encode_utf8(s).length;
}

 var username="",
     key_id,
     alg_max_version,
     alg_min_version = 1;

function passtype_to_str(type) {
    switch(type) {
        case 'x': return "Maximum";
        case 'l': return "Long";
        case 'm': return "Medium";
        case 'b': return "Basic";
        case 's': return "Short";
        case 'i': return "Pin";
        case 'n': return "Name";
        case 'p': return "Phrase";
        default: throw new Error("Unknown password type:"+type);
    }
}

function stored_sites_table_append(domain, site, type, loginname, count, ver) {
    let tr = document.importNode(document.querySelector('#stored_sites_row').content, true);
    let x = tr.querySelector('input.domainvalue');
    x.value = domain;
    x.setAttribute('data-old', domain);
    x = tr.querySelectorAll('td');
    x[0].textContent = site;
    x[2].textContent = loginname;
    x[3].textContent = count;
    x[4].textContent = passtype_to_str(type);
    x[5].textContent = ver;

    document.querySelector('#stored_sites > tbody').appendChild(tr);
}

function stored_sites_table_update(sites) {
    document.querySelector('#stored_sites > tbody').innerHTML = '';

    for (const site of sites) {
        stored_sites_table_append(site.url,
            site.sitename,
            site.type,
            site.username,
            site.generation,
            ""+site.required_alg_version(alg_min_version));
    }
}

window.addEventListener('load', function() {
    const promised_storage_get = (keys) => {
        return new Promise((resolve, fail) => {
            chrome.storage.local.get(keys, itms => {
                if (itms === undefined) resolve({});
                else resolve(itms);
            });
        });
    };

    promised_storage_get(['username', 'max_alg_version', 'key_id'])
    .then(data => {
        username = data.username;
        key_id = data.key_id;
        alg_max_version = data.max_alg_version;

        if (!string_is_plain_ascii(username)) {
            alg_min_version = Math.min(3, alg_max_version);
            if (alg_min_version > 2) {
                document.querySelector('#ver3note').style.display = 'inherit';
            }
        }
    });

    sitestore.get().then(sites=>{stored_sites_table_update(sites);})
    .catch((err) => {
        messagebox("Failed loading sites");
        console.error("Failed loading sites on load", err);
    });
});

function dragover_enter(e){
    e.preventDefault();
    e.stopPropagation();
}
document.addEventListener('dragover', dragover_enter);
document.addEventListener('dragenter', dragover_enter);

function find_parent(name, node) {
    if (!node) throw new Error("node argument required");
    if (!node.parentNode) throw new Error("node has no parent");
    node = node.parentNode;
    while(node.nodeName !== name) {
        if (!node.parentNode) throw new Error("No parent node found matching " + name);
        node = node.parentNode;
    }
    return node;
}

document.querySelector('#stored_sites').addEventListener('change', function(e) {
    if (!e.target.classList.contains('domainvalue')) return;
    let t = find_parent('TR', e.target),
        oldurl = e.target.getAttribute('data-old'),
        newurl = e.target.value,
        sitename = t.querySelector('td:nth-child(1)').textContent;

    const url = Array.from(new Set(newurl.split(',')))
    try {
        sitestore.update(sitename, {url});
    } catch (er) {
        if (er instanceof sitestore.NeedUpgradeError)
            messagebox(er.message);
        e.target.value = oldurl;
    }

    console.debug('Change',t,url,oldurl);
    e.target.setAttribute('data-old', newurl);
});

document.querySelector('#stored_sites').addEventListener('click', function(e) {
    if (!e.target.classList.contains('delete')) return;
    let t = find_parent('TR', e.target);
    let sitename = t.querySelector('td:nth-child(1)').textContent;
    let url = t.querySelector('input').getAttribute('data-old');

    try {
        sitestore.remove(sitename);
        t.parentNode.removeChild(t);
    } catch (er) {
        if (er instanceof sitestore.NeedUpgradeError)
            messagebox(er.message);
    }
});


function get_sitesearch(sitename) {
    let y = sitename.split("@");
    if (y.length > 1)
        return y[y.length-1];
    else
        return sitename;
}

function resolveConflict(site, existing) {
    return new Promise(function(resolve, reject){
        let div = document.querySelector('#conflict_resolve');

        div.querySelector('.sitename').textContent = site.sitename;
        div.querySelector('.domainvalue').textContent = site.sitesearch;
        div.querySelector('.existing_type').textContent = passtype_to_str(existing.type);
        div.querySelector('.existing_count').textContent = existing.generation;
        div.querySelector('.existing_username').textContent = existing.username;

        div.querySelector('.new_type').textContent = passtype_to_str(site.type);
        div.querySelector('.new_count').textContent = site.generation;
        div.querySelector('.new_username').textContent = site.username;

        function click_handler(ev) {
            switch (ev.target.id) {
                case 'existing':
                    resolve(existing);
                    break;
                case 'imported':
                    resolve(site);
                    break;
                default:
                    return;
            }
            div.removeEventListener('click', click_handler);
            div.style.display = 'none';
        }

        div.addEventListener('click', click_handler);
        div.style.display = '';
    });
}


document.querySelector('#importinput').addEventListener('change', function(e) {
    var fr=new FileReader();
    fr.onload=function(){
        import_mpsites(fr.result);
    }
    fr.readAsText(this.files[0]);
});

document.addEventListener('drop', function(e) {
    let dt = e.dataTransfer;
    dt.dropEffect='move';
    e.preventDefault();
    e.stopPropagation();
    if (dt.files.length !== 1) return;
    if (! /.*\.(mpsites|mpjson)$/gi.test(dt.files[0].name)) {
        messagebox("Error: need a .mpsites file");
        return;
    }

    if (sitestore.need_upgrade()) {
        messagebox("need data upgrade before import");
        return;
    }

    var fr = new FileReader();
    fr.onload=function(x){
        import_mpsites(x.target.result);
    }
    fr.readAsText(dt.files[0]);
});

async function import_mpsites(data) {
    let has_ver1_mb_sites = false;
    let imported_sites;

    try {
        imported_sites = mpw_utils.read_mpsites(data, username, key_id, confirm);
        if (!imported_sites) return;
    } catch (e) {
        if (e instanceof mpw_utils.MPsitesImportError) {
            messagebox("Error: "+e.message);
            return;
        }
        else throw e;
    }

    let sites = await sitestore.get();
    let site_index = new Map(sites.map((e, i) => [e.sitename, i]));

    for (let site of imported_sites) {
        if (!site.url)
            site.url = get_sitesearch(site.sitename);

        let conflict_idx = site_index.get(site.sitename);

        if (conflict_idx !== undefined) {
            let asite = sites[conflict_idx];
            if (site.equal(asite)) {
                asite.url = Array.from(new Set([...site.url, ...asite.url]));
                sites[conflict_idx] = asite;
            } else {
                let url = Array.from(new Set([...site.url, ...asite.url]));
                site = await resolveConflict(site, asite);
                site.url = url;
                sites[conflict_idx] = site;
            }
        } else {
            site_index.set(site.sitename, sites.length);
            sites.push(site);
        }

        if (site.passalgo < 2 && !string_is_plain_ascii(site.sitename))
            has_ver1_mb_sites = true;
    }

    sitestore.set(sites);
    stored_sites_table_update(sites);

    if (has_ver1_mb_sites)
        alert("Version mismatch\n\nYour file contains site names with non ascii characters from "+
              "an old masterpassword version. This addon can not reproduce these passwords");
    else {
        messagebox('Import successful');
    }
};

document.querySelector('body').addEventListener('click', function(ev){
    if (ev.target.classList.contains('import_mpsites')) {
        if (sitestore.need_upgrade()) {
            messagebox("need data upgrade before import");
            return;
        }
        document.querySelector('#importinput').click();
    }
    if (ev.target.classList.contains('export_mpsites_json')) {
        sitestore.get().then(sites=> {
            start_data_download(mpw_utils.make_mpsites(key_id, username, sites, alg_min_version, alg_max_version, true), 'firefox.mpjson');
        });
    }
    if (ev.target.classList.contains('export_mpsites')) {
        sitestore.get().then(sites=> {
            start_data_download(mpw_utils.make_mpsites(key_id, username, sites, alg_min_version, alg_max_version, false), 'firefox.mpsites');
        });
    }
    if (ev.target.classList.contains('accordion_toggle')) {
        let d = ev.target.parentNode;
        let is_in = d.classList.contains('in');
        let new_height = d.querySelector('div').offsetHeight + d.offsetHeight + 20;
        if (is_in)
            d.style.height = '';
        else
            d.style.height = new_height + 'px';
        d.classList.toggle('in');
        let reset_height = function () {
            d.style.height = '';
            d.removeEventListener('transitionend', reset_height);
        };
        d.addEventListener('transitionend', reset_height);
    }
});

function start_data_download(stringarr,filename) {
    let a = window.document.createElement('a');
    a.href = window.URL.createObjectURL(new Blob(stringarr, {type: 'text/plain'}));
    a.download = filename;

    // Append anchor to body.
    document.body.appendChild(a);
    a.click();

    // Remove anchor from body
    document.body.removeChild(a);
}

document.querySelector('#messagebox > div.progress').addEventListener('transitionend', ()=> {
    document.querySelector("#messagebox").classList.remove('visible');
});

function messagebox(txt) {
    document.querySelector("#messagebox").classList.add('visible');
    document.querySelector("#messagebox_text").innerHTML = txt;
}

}());
