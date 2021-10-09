/* Copyright Torbjorn Tyridal 2015

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
/*jshint browser:true, devel:true */
/* globals chrome, mpw */
import {defer, copy_to_clipboard} from "../lib/utils.js";
import {parseUri} from "../lib/uritools.js";
import {ui} from "./ui.js";

(function () {
    "use strict";

    function store_update(data) {
        browser.runtime.sendMessage({action: 'store_update', data: data })
        .catch(err=>{ console.log("BUG!",err); });
    }

    function sites_get(domain) {
        return browser.runtime.sendMessage({action: 'site_get', domain:domain})
        .catch(err=>{ console.log("BUG!",err); });
    }

    function sites_update(domain, sites) {
        return browser.runtime.sendMessage({action: 'site_update', data: {sites}})
        .catch(err=>{ console.log("BUG!",err); });
    }

function get_active_tab_url() {
    var ret = new Promise(function(resolve, fail){
        chrome.tabs.query({active:true,windowType:"normal",currentWindow:true}, function(tabres){
        if (tabres.length !== 1) {
            ui.user_warn("Error: bug in tab selector");
            console.log(tabres);
            throw new Error("plugin bug");
        } else
            resolve(tabres[0].url);
        });
    });
    return ret;
}

function update_page_password_input(pass, username) {
    browser.runtime.sendMessage({action: 'update_page_password',
        pass: pass,
        username: username,
        allow_subframe: true,
        allow_submit: !ui.is_visible('#storedids_dropdown')})
    .catch(e=>{
        console.info(e);
    });
}

var mpw_promise = defer(),
    session_store = {};

function resolve_mpw() {
    mpw_promise.resolve(
        mpw(
            session_store.username,
            session_store.masterkey,
            session_store.max_alg_version));
    mpw_promise.then(mpw_session => {
        ui.verify("Verify: " + mpw_session.sitepassword(".", 0, "nx"));

        var key_id = mpw_session.key_id();
        if (session_store.key_id && key_id !== session_store.key_id) {
            warn_keyid_not_matching();
            store_update({
                username: session_store.username,
                masterkey: session_store.masterkey});
        }
        else {
            session_store.key_id = key_id;
            store_update({
                username: session_store.username,
                masterkey: session_store.masterkey,
                key_id: key_id});
        }
    });
}

function recalculate() {
    let siteconfig = ui.siteconfig();
    siteconfig.generation = parseInt(siteconfig.generation, 10);

    mpw_promise.then(mpw_session => {
        if (!ui.sitename()) {
            ui.thepassword("(need a sitename!)");
            ui.user_info("need sitename");
            return;
        } else {
            ui.thepassword("(calculating..)");
            ui.user_info("Please wait...");
        }

        console.debug("calc password " +
                ui.sitename() +
                " . " +
                siteconfig.generation +
                " . " +
                siteconfig.type, ui.sitename(), !!ui.sitename());


        let pass = mpw_session.sitepassword(
                ui.sitename(),
                siteconfig.generation,
                siteconfig.type);

        ui.thepassword(Array(pass.length+1).join("\u00B7"), pass); // &middot;

        if (session_store.pass_to_clipboard)
            copy_to_clipboard("text/plain", pass);
        update_page_password_input(pass, siteconfig.username);
        //if (hide_after_copy) {
        //    addon.port.emit('close');
        //}
        if (session_store.pass_to_clipboard)
            ui.user_info("Password for " + ui.sitename() + " copied to clipboard");
        else
            ui.user_info("Password for " + ui.sitename() + " ready");
    });
}

function loadSettings(domain) {
    return sites_get(domain)
    .then(d=>{
        session_store.related_sites = [{sitename:"test1"},{sitename:"test4", generation:3, username:'tjoho'},{sitename:"test3", generation:10},{sitename:"test2"},];
        session_store.other_sites = [];
        for (let site of d.sitedata) {
            if (site.url.indexOf(domain) != -1) session_store.related_sites.push(site);
            else session_store.other_sites.push(site);
        }
        console.log(session_store);
        return domain;
    });
}

function updateUIForDomainSettings(domain)
{
    for (let d of document.querySelectorAll('.domain'))
        d.value = domain;

    if (session_store.related_sites.length > 1) {
        ui.show('#storedids_dropdown');
        ui.setStoredIds(session_store.related_sites);
    }

    if (session_store.related_sites.length > 0) {
        let first = session_store.related_sites[0];
        ui.sitename(first.sitename);
        ui.siteconfig(first.type, first.generation, first.username || '');
    } else {
        ui.sitename(domain);
        ui.siteconfig(session_store.defaulttype, 1, '');
    }
}

function extractDomainFromUrl(url) {
    if (url.startsWith('about:') || url.startsWith('resource:') || url.startsWith('moz-extension:'))
        url = '';
    var domain = parseUri(url).domain.split("."),
        significant_parts = 2;
    if (domain.length > 2 && domain[domain.length-2].toLowerCase() === "co")
        significant_parts = 3;
    while(domain.length > 1 && domain.length > significant_parts)
        domain.shift();
    domain = domain.join(".");
    return domain;
}

function showSessionSetup() {
    ui.hide('#main');
    ui.show('#sessionsetup');

    if (!session_store.username) {
        ui.focus('#username');
    } else {
        ui.username(session_store.username);
        ui.focus('#masterkey');
    }
}

function showMain() {
    ui.hide('#sessionsetup');
    ui.show('#main');
}

function popup() {
    if (session_store.username && session_store.masterkey) {
        showMain();
        setTimeout(()=>{ resolve_mpw();}, 1); // do later so page paints as fast as possible
    } else {
        showSessionSetup();
    }

    let urlpromise = get_active_tab_url()
    .catch(function(x) { //jshint ignore:line
        console.error('get_active_tab_url failed',x);
        ui.user_warn("failed to get tab url");
        setTimeout(()=>{ui.clear_warning()}, 2000);
        return '';
    })
    .then(extractDomainFromUrl)
    .then(loadSettings)
    .then(updateUIForDomainSettings);

    Promise.all([mpw_promise, urlpromise])
    .then(recalculate);
}

window.addEventListener('load', function () {
    browser.runtime.sendMessage({action: 'store_get', keys:
        ['username', 'masterkey', 'key_id', 'max_alg_version', 'defaulttype', 'pass_to_clipboard']})
    .then(data => {
        if (data.pwgw_failure) {
            let e = ui.user_warn("System password vault failed! ");
            e = e.appendChild(document.createElement('a'));
            e.href = "https://github.com/ttyridal/masterpassword-firefox/wiki/Key-vault-troubleshooting";
            e.target = "_blank";
            e.textContent = "Help?";
            data.masterkey=undefined;
            session_store.username = data.username;
        } else {
            ui.user_info("");
            Object.assign(session_store, data);
        }
        popup();
    })
    .catch(err => {
        console.error(err);
        console.error("Failed loading state from background on popup");
        ui.user_warn("BUG. please check log and report");
    });
},false);

document.querySelector('#sessionsetup > form').addEventListener('submit', function(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    let username = document.querySelector('#username'),
        masterkey= document.querySelector('#masterkey');

    if (username.value.length < 2) {
        ui.user_warn('Please enter a name (>2 chars)');
        username.focus();
    }
    else if (masterkey.value.length < 2) {
        ui.user_warn('Please enter a master key (>2 chars)');
        masterkey.focus();
    }
    else {
        session_store.username = username.value;
        session_store.masterkey= masterkey.value;
        masterkey.value = '';

        ui.hide('#sessionsetup');
        ui.show('#main');
        resolve_mpw();
    }
});

document.querySelector('#storedids_dropdown').addEventListener('click', function(ev){
    document.querySelector('#sitename').open();
});

function lookup_stored_site_obj(sitename) {
    let cur = null;
    let curidx = session_store.related_sites.findIndex(e => e.sitename == sitename);
    if (curidx == -1)
        curidx = session_store.other_sites.findIndex(e => e.sitename == sitename);
    else
        return session_store.related_sites[curidx];
    if (curidx != -1)
        cur = session_store.other_sites[curidx];
    return cur;
}

function save_site_changes(){
    let domain = ui.domain();
    let sn = ui.sitename();

    let site = lookup_stored_site_obj(sn);
    if (site)
        Object.assign(site, ui.siteconfig());
    else {
        site = Object.assign({sitename: sn, url: domain}, ui.siteconfig());
        session_store.related_sites.push(site);
    }

    ui.setStoredIds(session_store.related_sites);

    if (domain !== '' && !chrome.extension.inIncognitoContext)
        sites_update(domain, site);

    if (session_store.related_sites.length > 1)
        ui.show('#storedids_dropdown');
}

function warn_keyid_not_matching()
{
    console.debug("keyids did not match!");
    let e = ui.user_warn("Master password possible mismatch! ");
    e = e.appendChild(document.createElement('button'));
    e.id = 'change_keyid_ok';
    e.setAttribute('title', "set as new");
    e.textContent = "OK";
}

document.querySelector('#main').addEventListener('change', function(ev){
    console.log("change:", ev.target);
    if (ev.target == document.querySelector('mp-combobox')) {
        let site = lookup_stored_site_obj(ev.target.value);
        if (!site)
            site = {type: session_store.defaulttype, generation: 1, username:''}
        ui.siteconfig(site.type||session_store.defaulttype, site.generation||1, site.username||'');
    } else
        save_site_changes();
    recalculate();
});

document.querySelector('#thepassword').addEventListener('click', function(ev) {
    let t = ev.target.parentNode;
    let dp = t.getAttribute('data-pass');
    if (dp) {
        t.textContent = dp;
        t.setAttribute('data-visible', 'true');
    }
    ev.preventDefault();
    ev.stopPropagation();
});

document.querySelector('#copypass').addEventListener('click', function(ev) {
    let pass = document.querySelector('#thepassword').getAttribute('data-pass');
    copy_to_clipboard("text/plain", pass);
    if (pass && pass !== '')
        ui.user_info("Password for " + ui.sitename() + " copied to clipboard");
});

document.querySelector('body').addEventListener('click', function(ev) {
    if (ev.target.classList.contains('btnconfig')) {
        chrome.tabs.create({'url': '../options/index.html'}, function(tab) { });
    }
    else if (ev.target.classList.contains('btnlogout')) {
        session_store.masterkey = null;
        store_update({masterkey: null});
        mpw_promise = defer();
        ui.clear_warning();
        ui.user_info("Session destroyed");
        popup();
    }
    else if (ev.target.id === 'change_keyid_ok') {
        mpw_promise.then(mpw_session => {
            session_store.key_id = mpw_session.key_id();
            store_update({
                username: session_store.username,
                masterkey: session_store.masterkey,
                key_id: session_store.key_id,
                force_update: true
            });
        });
        ui.clear_warning();
        ui.user_info("ready");
    }
});

document.querySelector('#siteconfig_show').addEventListener('click', function(ev) {
    let sc = document.querySelector('#siteconfig');
    sc.style.transform = 'scale(0,0)';
    sc.style.transformOrigin = '0 0';
    sc.style.transition = 'none';
    window.setTimeout(()=>{
        sc.style.transition = '0.2s ease-out';
        sc.style.transform = 'scale(1,1)';
    }, 1);
    ui.show(sc);
    ui.hide('#siteconfig_show');
});

}());
