/*  
 * Copyright (c) 2018 Authors of "A Blockchain-Based File Sharing System for Academic Paper Review System"   
 *  
 *  This file is free software: you may copy, redistribute and/or modify it  
 *  under the terms of the GNU Lesser General Public License as published by the  
 *  Free Software Foundation, either version 3 of the License, or (at your  
 *  option) any later version.  
 *  
 *  This file is distributed in the hope that it will be useful, but  
 *  WITHOUT ANY WARRANTY; without even the implied warranty of  
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU  
 *  Lesser General Public License for more details.  
 *  
 *  You should have received a copy of the GNU Lesser General Public License  
 *  along with this program.  If not,  see <http://www.gnu.org/licenses/>..  
 *  
 * 	This file incorporates work of the Hyperledger Project covered by the following copyright and  
 * 	permission notice:  
 *  
 * 		Licensed under the Apache License, Version 2.0 (the "License");
 * 		you may not use this file except in compliance with the License.
 * 		You may obtain a copy of the License at
 *
 * 		http://www.apache.org/licenses/LICENSE-2.0
 *
 * 		Unless required by applicable law or agreed to in writing, software
 * 		distributed under the License is distributed on an "AS IS" BASIS,
 * 		WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * 		See the License for the specific language governing permissions and
 * 		limitations under the License.
 */

/**
 * Creating paperInfo and create subscription for owner
 * @param {org.acad.acadpaperreview.CreatePaperInfo} tx - the transaction to be processed
 * @transaction
 */
async function createPaperInfo(tx) {
	// Check paperInfo
	let paperInfos = await query('selectPaperInfoByPaper', {paperId: "resource:"+tx.paper.getFullyQualifiedIdentifier()});

	if (paperInfos.length > 0) {
		throw new Error('PaperInfo exists');
	}

	// Create paper info
	let factory = getFactory();
    let paperInfoRegistry = await getAssetRegistry('org.acad.acadpaperreview.PaperInfo');

    let newPaperInfo = factory.newResource('org.acad.acadpaperreview', 'PaperInfo', uuidv4());
    newPaperInfo.IPFSHash = tx.IPFSHash;
    newPaperInfo.decryptKey = tx.decryptKey;
    newPaperInfo.paper = tx.paper;

    // create subscription for owner
    newPaperInfo.users = [];
    newPaperInfo.users.push(tx.paper.owner);

    await paperInfoRegistry.add(newPaperInfo);
}

/**
 * Subscribe a paper by creating a PaperSubscription asset
 * @param {org.acad.acadpaperreview.SubscribePaper} tx - the transaction to be processed
 * @transaction
 */
async function subscribePaper(tx) {
	// Check paperInfo
	let paperInfos = await query('selectPaperInfoByPaper', {paperId: "resource:"+tx.paper.getFullyQualifiedIdentifier()});

	if (paperInfos.length == 0) {
		throw new Error('No existing paper info found for this paper');
	}

	// Check publication status
	let submissions = await query('selectSubmissionByPaper', {paperId: "resource:"+tx.paper.getFullyQualifiedIdentifier()});
	let published = false;
	for (let i = 0; i < submissions.length; i++) {
		let singleSubmission = submissions[i];

		// Check submission status
		if (singleSubmission.status == "Pass")
		{
			published = true;
			break;
		}
	}

	if (!published)
	{
		throw new Error('Paper not published');
	}

	// Check if already subscribed
    let assetRegistry = await getAssetRegistry('org.acad.acadpaperreview.PaperInfo');

    let singleInfo = paperInfos[0];

    for (let i = 0;i < singleInfo.users.length;i++) {
    	let singleUser = singleInfo.users[i];
    	if (singleUser.getIdentifier() == tx.newUser.getIdentifier())
    	{
    		throw new Error('Already subscribed');
    	}
    }

    // Check Coins
    let coinRegistry = await getAssetRegistry('org.acad.acadpaperreview.AcadCoin');
    let coins = await query('selectAcadCoinByOwner', {ownerId: "resource:"+tx.newUser.getFullyQualifiedIdentifier()});

    // Check Coin Num
    if (coins.length < tx.paper.acadCoinNum)
    {
    	throw new Error('Not enough coins');
    }

    // Pay
    for (let i = 0; i < tx.paper.acadCoinNum; i++) {
    	let singleCoin = coins[i];
    	singleCoin.owner = tx.paper.owner;
    	await coinRegistry.update(singleCoin);
    }

    // Create new subscription
    singleInfo.users.push(tx.newUser);
    await assetRegistry.update(singleInfo);
}

/**
 * Submit a paper to a conference by creating a Submission asset
 * @param {org.acad.acadpaperreview.SubmitPaper} tx - the transaction to be processed
 * @transaction
 */
async function submitPaper(tx) {
	// Check paper publication
	if (tx.paper.published != "NotPub")
	{
		throw new Error('Paper published variable cannot be published or submitted');
	}

	// Check conference status
	if (tx.conference.conStatus != "Open") {
		throw new Error('Conference stopped accepting papers');
	}

	// Check keywords
	if (!keywordsMatch(tx.paper.keywords, tx.conference.keywords))
	{
		throw new Error('Paper doesn\'t match with conference');
	}

	// Check paperInfo
	let paperInfos = await query('selectPaperInfoByPaper', {paperId: "resource:"+tx.paper.getFullyQualifiedIdentifier()});

	if (paperInfos.length == 0) {
		throw new Error('No existing paper info found for this paper');
	}

	/* Check conference paper num
	let conSubmissions = await query('selectSubmissionByConference', {conferenceId: "resource:"+tx.conference.getFullyQualifiedIdentifier()});

	if (conSubmissions.length >= tx.conference.paperNum)
	{
		throw new Error('The conference have enough submissions to access');
	}
	*/

	// Check owner request
	let requestList = await query('selectReviewRequestByNameAndConference', {academicId: "resource:"+tx.paper.owner.getFullyQualifiedIdentifier(), conferenceId: "resource:"+tx.conference.getFullyQualifiedIdentifier()});
	if (requestList.length > 0)
	{
		throw new Error('Already exists as a potential reviewer');
	}

	// Check author request
	for (let i = 0; i < tx.paper.authors.length; i++) {
		let author = tx.paper.authors[i]
		let authorRequestList = await query('selectReviewRequestByNameAndConference', {academicId: "resource:"+author.getFullyQualifiedIdentifier(), conferenceId: "resource:"+tx.conference.getFullyQualifiedIdentifier()});
		if (authorRequestList.length > 0)
		{
			throw new Error('Already exists as a potential reviewer');
		}
	}

	// Check submission
	let submissions = await query('selectSubmissionByPaper', {paperId: "resource:"+tx.paper.getFullyQualifiedIdentifier()});

	for (let i = 0; i < submissions.length; i++) {
		let singleSubmission = submissions[i];

		// Check submission status
		if (singleSubmission.status != "Fail")
		{
			throw new Error('Already submitted or published');
		}
	}

	// Create submission
	let factory = getFactory();
	let submissionRegistry = await getAssetRegistry('org.acad.acadpaperreview.Submission');
	let newSubmission = factory.newResource('org.acad.acadpaperreview', 'Submission', uuidv4());
	newSubmission.paper = tx.paper;
	newSubmission.conference = tx.conference;
	newSubmission.status = "Pending";
	await submissionRegistry.add(newSubmission);

    // create subscription for conference owner
    let singleInfo = paperInfos[0];
    let paperInfoRegistry = await getAssetRegistry('org.acad.acadpaperreview.PaperInfo');
    let subscribe = true;
    for (let i = 0;i < singleInfo.users.length;i++) {
    	let singleUser = singleInfo.users[i];
    	if (singleUser.getIdentifier() == tx.conference.publisher.getIdentifier())
    	{
    		subscribe = false;
    		break;
    	}
    }

    if (subscribe)
    {
    	singleInfo.users.push(tx.conference.publisher);

    	await paperInfoRegistry.update(singleInfo);
    }

    // Paper Status Change
    let paperRegistry = await getAssetRegistry('org.acad.acadpaperreview.Paper');
    let submittedPaper = tx.paper;
    submittedPaper.published = "Submitted";
    await paperRegistry.update(submittedPaper);
}

/**
 * Request to be a reviewer in a conference by creating a ReviewRequest asset
 * @param {org.acad.acadpaperreview.RequestReview} tx - the transaction to be processed
 * @transaction
 */
async function requestReview(tx) {
	// Compare keywords
	if (!keywordsMatch(tx.academic.interest, tx.conference.keywords))
	{
		throw new Error('Your interest doesn\'t match with the Conference');
	}

	// Check Rating
	let reviewList = await query('selectReviewedByAcademic', {authorId: "resource:"+tx.academic.getFullyQualifiedIdentifier()});

	let rating = 5.0;

	if (reviewList.length > 0)
	{
		let sum = 0.0;
		for (let i = 0; i < reviewList.length; i++) {
			let singleReview = reviewList[i];
			sum += singleReview.rating;
		}
		rating = sum / reviewList.length;
	}

	if (rating < tx.conference.reviewerRating)
	{
		throw new Error('Your reviewer Rating is lower than the conference requirement');
	}

	// Check if submitted paper
	let submissionList = await query('selectSubmissionByConference', {conferenceId: "resource:"+tx.conference.getFullyQualifiedIdentifier()});
	for (let i = 0; i < submissionList.length; i++) {
		let singleSubmission = submissionList[i];
		let papers = await query('selectPaperByIdentifier', {workId: singleSubmission.paper.getIdentifier()});
		let singlePaper = papers[0];
		// Check Paper Owner
		if (singlePaper.owner.getIdentifier() == tx.academic.getIdentifier())
		{
			throw new Error('You are an owner of a submitted paper');
		}
		// Check Paper Author
		for (let j = 0;j < singlePaper.authors.length;j++)
		{
			let author = singlePaper.authors[j];
			if (tx.academic.getIdentifier() == author.getIdentifier())
			{
				throw new Error('You are an author of a submitted paper');
			}
		}
	}

	// Check if submitted
	let requestList = await query('selectReviewRequestByNameAndConference', {academicId: "resource:"+tx.academic.getFullyQualifiedIdentifier(), conferenceId: "resource:"+tx.conference.getFullyQualifiedIdentifier()});
	if (requestList.length > 0)
	{
		throw new Error('Already submitted request in this conference');
	}

	// Create new Request
	let factory = getFactory();
    let requestRegistry = await getAssetRegistry('org.acad.acadpaperreview.ReviewRequest');

    let newRequest = factory.newResource('org.acad.acadpaperreview', 'ReviewRequest', uuidv4());
    newRequest.conference = tx.conference;
    newRequest.academic = tx.academic;
    newRequest.payment = tx.conference.payment;

    await requestRegistry.add(newRequest);
}

/**
 * Allocate papers by creating new Review and subscription, also pays the reviewer
 * @param {org.acad.acadpaperreview.AllocatePapers} tx - the transaction to be processed
 * @transaction
 */
async function allocatePapers(tx) {
	// Check Review per paper
	if (tx.reviewPerPaper < 1)
	{
		throw new Error('There need to be at least one reviewer to review a paper');
	}

	// Check Coins
    let coinRegistry = await getAssetRegistry('org.acad.acadpaperreview.AcadCoin');
    let coins = await query('selectAcadCoinByOwner', {ownerId: "resource:"+tx.conference.publisher.getFullyQualifiedIdentifier()});

    // Check Coin max Num
    let maxCoins = tx.maxCoins;
    if (tx.maxCoins <= 0)
    {
    	maxCoins = coins.length;
    }

    if (coins.length < maxCoins)
    {
    	throw new Error('Not enough coins');
    }

    // Allocate 
    let requestList = await query('selectReviewRequestByConference', {conferenceId: "resource:"+tx.conference.getFullyQualifiedIdentifier()});
    let submissionList = await query('selectPendingSubmissionByConference', {conferenceId: "resource:"+tx.conference.getFullyQualifiedIdentifier()});
    let reviewRegistry = await getAssetRegistry('org.acad.acadpaperreview.Review');
    let infoRegistry = await getAssetRegistry('org.acad.acadpaperreview.PaperInfo')

    if (submissionList.length < tx.conference.paperNum)
    {
    	throw new Error('Not enough papers');
    }

    if (submissionList.length * tx.reviewPerPaper > requestList.length)
    {
    	throw new Error('Not enough reviewer');
    }

    let index = 0;
    let coinIndex = 0;

    let factory = getFactory();
    for (let k = 0;k < tx.reviewPerPaper;k++) {
		for (let l = 0;l < tx.conference.paperNum;l++) {
			let singleSubmission = submissionList[l];
			let singleRequest = requestList[index];
			// Add Review
			let newReview = factory.newResource('org.acad.acadpaperreview', 'Review', uuidv4());
			newReview.owner = tx.conference.publisher;
			newReview.author = singleRequest.academic;
			newReview.IPFSHash = "";
			newReview.reviewStatus = "Pending";
			newReview.paper = singleSubmission.paper;
			newReview.conference = tx.conference;
			newReview.rating = -1.0;
			await reviewRegistry.add(newReview);

			// Add Subscription
			let infoList = await query('selectPaperInfoByPaper', {paperId: "resource:" + singleSubmission.paper.getFullyQualifiedIdentifier()});
			let singleInfo = infoList[0];
			singleInfo.users.push(singleRequest.academic);
			await infoRegistry.update(singleInfo);

			// Payment
			for (let n = 0; n < singleRequest.payment; n++) {
				if (coinIndex >= maxCoins)
				{

					throw new Error('Not enough coins');
				}
				let singleCoin = coins[coinIndex];
				singleCoin.owner = singleRequest.academic;
				await coinRegistry.update(singleCoin);
				coinIndex++
			}

			index++;
		}
	}
}

/**
 * Write a review
 * @param {org.acad.acadpaperreview.SubmitReview} tx - the transaction to be processed
 * @transaction
 */
async function submitReview(tx) {
	if (tx.review.reviewStatus != "Pending")
	{
		throw new Error('Already reviewed');
	}

	// Check new status
	if (tx.status == "Fail" || tx.status == "Pass")
	{
		let reviewRegistry = await getAssetRegistry('org.acad.acadpaperreview.Review');
		let review = tx.review;
		review.IPFSHash = tx.IPFSHash;
		review.reviewStatus = tx.status;
		await reviewRegistry.update(review);
	}
	else
	{
		throw new Error('The new status should be Fail or Pass');
	}
}

/**
 * Assess a certain submission and pay if the submission passes
 * @param {org.acad.acadpaperreview.AssessPaper} tx - the transaction to be processed
 * @transaction
 */
async function assessPaper(tx) {
	if (tx.newState == "Fail" || tx.newState == "Pass")
	{
		let submitRegistry = await getAssetRegistry('org.acad.acadpaperreview.Submission');
		let submission = tx.submission;
		submission.status = tx.newState;
		await submitRegistry.update(submission);

		let paperRegistry = await getAssetRegistry('org.acad.acadpaperreview.Paper');
    	let singlePaper = tx.submission.paper;
		// Get paper if paper passes
		if (tx.newState == "Pass")
		{
			/*
    		// Check Coins
    		let coinRegistry = await getAssetRegistry('org.acad.acadpaperreview.AcadCoin');
    		let coins = await query('selectAcadCoinByOwner', {ownerId: "resource:"+tx.submission.conference.publisher.getFullyQualifiedIdentifier()});

    		// Check Coin Num
    		if (coins.length < tx.submission.paper.acadCoinNum)
    		{
    			throw new Error('Not enough coins');
    		}

    		// Pay
    		for (let i = 0; i < tx.paper.acadCoinNum; i++) {
    			let singleCoin = coins[i];
    			singleCoin.owner = tx.paper.owner;
    			await coinRegistry.update(singleCoin);
    		}
    		*/
    		// Get ownership and publish
    		let conList = await query('selectConByIdentifier', {conferenceId: tx.submission.conference.getIdentifier()});
    		let singleCon = conList[0];
    		singlePaper.owner = singleCon.publisher;
    		singlePaper.published = "Published";
		}
		else
		{
			// Failed return to not published state
    		singlePaper.published = "NotPub";
		}
		await paperRegistry.update(singlePaper);
	}
	else
	{
		throw new Error('The new status should be Fail or Pass');
	}
}

/* Helper Functions */

// uuid
function uuidv4() {
 	return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
 		(c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
 	)
}

// Match keywords
function keywordsMatch(list1, list2)
{
	for(let i = 0; i < list1.length;i++)
	{
		for(let j = 0; j < list2.length;j++)
		{
			if (list1[i] == list2[j]) {
				return true;
			}
		}
	}
	return false;
}